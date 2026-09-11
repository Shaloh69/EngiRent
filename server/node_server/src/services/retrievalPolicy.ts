/**
 * E4.6 — when an item is released back to its owner, and when it must not be.
 *
 * RULED BY THE USER 2026-09-12. The bay is two compartments, not one: an item
 * is inserted through `main_door` into the upper compartment, and the linear
 * actuator's extend stroke drops it into the lower compartment, from which the
 * owner collects it through `bottom_door`. A "drop" is therefore not part of a
 * deposit — it is the act of giving an item back, and it was the missing half
 * of the whole design (D-67, D-68, D-69, D-70, D-71).
 *
 * THIS MODULE IS PURE ON PURPOSE. No Prisma, no socket, no clock of its own.
 * Every decision about driving a 22-second actuator stroke in a corridor is
 * made here, where it can be proven by a unit test, because the alternative is
 * proving it with a student's property inside the machine. The executor that
 * actually sends the command is deliberately dumb.
 */

/** Mirrors the Prisma enum without importing the client into a pure module. */
export type ReleaseReason =
  | "LATE_COLLECTION"
  | "OWNER_RETURN_PICKUP"
  | "CANCELLED_WITH_ITEM"
  | "DEPOSIT_REJECTED"
  | "RETURN_DISPUTED";

export interface RetrievalPolicy {
  auto_release_enabled: boolean;
  /** The user's "late for an hour or more". Hours after `depositedAt`. */
  collection_grace_hours: number;
  /** The user's "specific hour of the day" — local hours, 0-23, inclusive start. */
  release_window_start_hour: number;
  /** Exclusive end. A window of 7..21 means a drop may start up to 20:59. */
  release_window_end_hour: number;
  /** After this long un-collected, raise an admin escalation. Never auto-anything. */
  owner_retrieval_deadline_hours: number;
}

export const DEFAULT_RETRIEVAL_POLICY: RetrievalPolicy = {
  auto_release_enabled: true,
  collection_grace_hours: 1,
  release_window_start_hour: 7,
  release_window_end_hour: 21,
  owner_retrieval_deadline_hours: 72,
};

/** Everything the decision needs. Assembled by the caller from Prisma rows. */
export interface ReleaseCandidate {
  rentalId: string;
  status: string;
  depositedAt: Date | null;
  /** Set once a release has been asked for. Non-null means "already in flight or done". */
  releaseRequestedAt: Date | null;
  /** The bay physically holding the item, if the system believes it holds one. */
  locker: {
    id: string;
    lockerNumber: string;
    status: string;
    isOperational: boolean;
  } | null;
  /** True while a student is mid-flow at this bay — a hand may be inside. */
  hasLiveKioskSession: boolean;
  /** True while the kiosk reports any door on this bay open. */
  hasOpenDoor: boolean;
}

export type ReleaseDecision =
  | { release: true; reason: ReleaseReason }
  | { release: false; because: string; code: RefusalCode };

export type RefusalCode =
  | "already_requested"
  | "no_locker"
  | "bay_not_operational"
  | "bay_busy"
  | "lower_compartment_full"
  | "auto_release_disabled"
  | "outside_release_window"
  | "grace_not_elapsed"
  | "no_deposit_timestamp"
  | "status_has_no_release";

function refuse(code: RefusalCode, because: string): ReleaseDecision {
  return { release: false, because, code };
}

/**
 * Is `now` inside the configured release window?
 *
 * Handles a window that wraps midnight (start 22, end 6) because an operator
 * will eventually configure one, and the naive `h >= start && h < end` is
 * silently always-false for those.
 */
export function isWithinReleaseWindow(now: Date, policy: RetrievalPolicy): boolean {
  const h = now.getHours();
  const { release_window_start_hour: start, release_window_end_hour: end } = policy;
  if (start === end) return true; // a zero-width window means "no restriction"
  return start < end ? h >= start && h < end : h >= start || h < end;
}

/** Whole hours elapsed, floored — matches how the late-fee cron counts days. */
export function hoursSince(from: Date, now: Date): number {
  return (now.getTime() - from.getTime()) / 3_600_000;
}

/**
 * Which release reason, if any, does this rental's status imply?
 *
 * R2-R5 are *event-driven* — something already happened (a return passed, a
 * deposit was rejected, a rental was cancelled) and the item must go back with
 * no waiting period. Only R1 is time-driven, and only R1 consults the grace
 * period and the window.
 */
export function reasonForStatus(status: string): ReleaseReason | null {
  switch (status) {
    case "DEPOSITED":
      return "LATE_COLLECTION"; // R1 — time-driven, see the grace check
    case "VERIFICATION":
      return "OWNER_RETURN_PICKUP"; // R2
    case "CANCELLED":
      return "CANCELLED_WITH_ITEM"; // R3 and R4 — see note below
    case "DISPUTED":
      return "RETURN_DISPUTED"; // R5
    default:
      return null;
  }
}

/**
 * The whole decision. Order matters: the cheap, absolute refusals come first so
 * a bay that must not move is never even considered against a clock.
 *
 * `onDemand` marks a release the OWNER asked for (R2) rather than one the
 * scheduler proposed. An owner standing at the kiosk asking for their own item
 * is not subject to the release window or the auto-release switch — those exist
 * to stop the machine acting unattended, which is exactly what this is not.
 */
export function decideRelease(
  candidate: ReleaseCandidate,
  now: Date,
  policy: RetrievalPolicy,
  opts: { onDemand?: boolean } = {},
): ReleaseDecision {
  const { onDemand = false } = opts;

  // F1 — idempotency. The DB row, not an in-memory flag: two cron ticks, or a
  // cron tick racing an owner request, must not both drive the actuator.
  if (candidate.releaseRequestedAt !== null) {
    return refuse("already_requested", "a release has already been requested for this rental");
  }

  const reason = reasonForStatus(candidate.status);
  if (reason === null) {
    return refuse("status_has_no_release", `rental status ${candidate.status} has no release path`);
  }

  if (candidate.locker === null) {
    return refuse("no_locker", "no bay is recorded as holding this item");
  }

  // F7 — never drive a bay an operator has taken out of service.
  if (
    !candidate.locker.isOperational ||
    candidate.locker.status === "MAINTENANCE" ||
    candidate.locker.status === "OUT_OF_SERVICE"
  ) {
    return refuse("bay_not_operational", `bay ${candidate.locker.lockerNumber} is not operational`);
  }

  // F4 — the AWAITING_RETRIEVAL invariant. A second drop would stack two
  // students' property in one compartment.
  if (candidate.locker.status === "AWAITING_RETRIEVAL") {
    return refuse(
      "lower_compartment_full",
      `bay ${candidate.locker.lockerNumber} already holds an un-collected item in its lower compartment`,
    );
  }

  // F2 — a hand may be inside. This one is not negotiable by `onDemand`: an
  // owner requesting their item does not make someone else's hand safe.
  if (candidate.hasLiveKioskSession || candidate.hasOpenDoor) {
    return refuse(
      "bay_busy",
      `bay ${candidate.locker.lockerNumber} has a live session or an open door`,
    );
  }

  // An owner asking for their own item, in person, is attended by definition.
  if (onDemand) return { release: true, reason };

  if (!policy.auto_release_enabled) {
    return refuse("auto_release_disabled", "automatic release is switched off for this kiosk");
  }

  // F10 — never drop into an unattended compartment out of hours.
  if (!isWithinReleaseWindow(now, policy)) {
    return refuse(
      "outside_release_window",
      `outside the release window ${policy.release_window_start_hour}:00-${policy.release_window_end_hour}:00`,
    );
  }

  // R1 is the only time-driven trigger.
  if (reason === "LATE_COLLECTION") {
    if (candidate.depositedAt === null) {
      return refuse("no_deposit_timestamp", "rental is DEPOSITED but carries no depositedAt");
    }
    const elapsed = hoursSince(candidate.depositedAt, now);
    if (elapsed < policy.collection_grace_hours) {
      return refuse(
        "grace_not_elapsed",
        `${elapsed.toFixed(2)}h since deposit, grace is ${policy.collection_grace_hours}h`,
      );
    }
  }

  return { release: true, reason };
}

/**
 * F6 — has a released item sat in the lower compartment long enough that a
 * person should be told? This raises an escalation and deliberately triggers
 * no machine action: an unclaimed physical object is a human decision.
 */
export function needsRetrievalEscalation(
  releasedAt: Date | null,
  retrievedAt: Date | null,
  now: Date,
  policy: RetrievalPolicy,
): boolean {
  if (releasedAt === null || retrievedAt !== null) return false;
  return hoursSince(releasedAt, now) >= policy.owner_retrieval_deadline_hours;
}

/**
 * F3 — a drop was commanded and never acknowledged. Run on kiosk reconnect.
 * The item may be in either compartment, so this must never be auto-retried
 * blind; it is surfaced for reconciliation.
 */
export function isUnacknowledgedRelease(
  releaseRequestedAt: Date | null,
  releasedAt: Date | null,
  now: Date,
  staleAfterSeconds = 120,
): boolean {
  if (releaseRequestedAt === null || releasedAt !== null) return false;
  return (now.getTime() - releaseRequestedAt.getTime()) / 1000 >= staleAfterSeconds;
}

/** Reads the policy out of a KioskConfig JSON blob, falling back per-field. */
export function readRetrievalPolicy(config: unknown): RetrievalPolicy {
  const raw =
    config && typeof config === "object"
      ? ((config as Record<string, unknown>).retrieval as Record<string, unknown> | undefined)
      : undefined;
  if (!raw) return { ...DEFAULT_RETRIEVAL_POLICY };

  const num = (k: keyof RetrievalPolicy, fallback: number): number => {
    const v = raw[k];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  return {
    auto_release_enabled:
      typeof raw.auto_release_enabled === "boolean"
        ? raw.auto_release_enabled
        : DEFAULT_RETRIEVAL_POLICY.auto_release_enabled,
    collection_grace_hours: num("collection_grace_hours", DEFAULT_RETRIEVAL_POLICY.collection_grace_hours),
    release_window_start_hour: num("release_window_start_hour", DEFAULT_RETRIEVAL_POLICY.release_window_start_hour),
    release_window_end_hour: num("release_window_end_hour", DEFAULT_RETRIEVAL_POLICY.release_window_end_hour),
    owner_retrieval_deadline_hours: num(
      "owner_retrieval_deadline_hours",
      DEFAULT_RETRIEVAL_POLICY.owner_retrieval_deadline_hours,
    ),
  };
}
