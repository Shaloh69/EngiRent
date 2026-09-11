import {
  decideRelease,
  isWithinReleaseWindow,
  reasonForStatus,
  needsRetrievalEscalation,
  isUnacknowledgedRelease,
  readRetrievalPolicy,
  DEFAULT_RETRIEVAL_POLICY,
  ReleaseCandidate,
  RetrievalPolicy,
} from "../retrievalPolicy";

/**
 * E4.6. Every one of these is a 22-second actuator stroke in a corridor with a
 * student's property inside, so the whole point of the policy module being pure
 * is that these can be proven here instead of there.
 *
 * Failure modes F1-F10 from the phase file each have at least one test.
 */

const POLICY: RetrievalPolicy = { ...DEFAULT_RETRIEVAL_POLICY };

/** 2026-09-12 12:00 local — inside the default 07:00-21:00 window. */
const NOON = new Date(2026, 8, 12, 12, 0, 0);

function candidate(over: Partial<ReleaseCandidate> = {}): ReleaseCandidate {
  return {
    rentalId: "r1",
    status: "DEPOSITED",
    depositedAt: new Date(NOON.getTime() - 3 * 3_600_000), // 3h ago
    releaseRequestedAt: null,
    locker: { id: "l1", lockerNumber: "2", status: "OCCUPIED", isOperational: true },
    hasLiveKioskSession: false,
    hasOpenDoor: false,
    ...over,
  };
}

describe("reasonForStatus — the five ruled triggers, R1-R5", () => {
  it.each([
    ["DEPOSITED", "LATE_COLLECTION"],
    ["VERIFICATION", "OWNER_RETURN_PICKUP"],
    ["CANCELLED", "CANCELLED_WITH_ITEM"],
    ["DISPUTED", "RETURN_DISPUTED"],
  ])("%s releases as %s", (status, reason) => {
    expect(reasonForStatus(status)).toBe(reason);
  });

  it.each(["PENDING", "AWAITING_DEPOSIT", "ACTIVE", "COMPLETED"])(
    "%s has no release path",
    (status) => {
      expect(reasonForStatus(status)).toBeNull();
    },
  );
});

describe("F1 — idempotency: the actuator fires once", () => {
  it("refuses when a release has already been requested", () => {
    const d = decideRelease(candidate({ releaseRequestedAt: NOON }), NOON, POLICY);
    expect(d).toMatchObject({ release: false, code: "already_requested" });
  });

  it("refuses even an on-demand owner request once one is in flight", () => {
    // A cron tick racing an owner at the kiosk must not double-drop.
    const d = decideRelease(
      candidate({ status: "VERIFICATION", releaseRequestedAt: NOON }),
      NOON,
      POLICY,
      { onDemand: true },
    );
    expect(d).toMatchObject({ release: false, code: "already_requested" });
  });
});

describe("F2 — never move a bay someone may have a hand inside", () => {
  it("refuses while a kiosk session is live", () => {
    expect(decideRelease(candidate({ hasLiveKioskSession: true }), NOON, POLICY)).toMatchObject({
      release: false,
      code: "bay_busy",
    });
  });

  it("refuses while a door on that bay is open", () => {
    expect(decideRelease(candidate({ hasOpenDoor: true }), NOON, POLICY)).toMatchObject({
      release: false,
      code: "bay_busy",
    });
  });

  it("an owner asking in person does NOT override a busy bay", () => {
    // onDemand relaxes the window and the auto switch, never safety.
    const d = decideRelease(
      candidate({ status: "VERIFICATION", hasOpenDoor: true }),
      NOON,
      POLICY,
      { onDemand: true },
    );
    expect(d).toMatchObject({ release: false, code: "bay_busy" });
  });
});

describe("F4 — the AWAITING_RETRIEVAL invariant", () => {
  it("refuses to drop onto an item already in the lower compartment", () => {
    const d = decideRelease(
      candidate({ locker: { id: "l1", lockerNumber: "2", status: "AWAITING_RETRIEVAL", isOperational: true } }),
      NOON,
      POLICY,
    );
    expect(d).toMatchObject({ release: false, code: "lower_compartment_full" });
  });
});

describe("F7 — bays out of service", () => {
  it.each(["MAINTENANCE", "OUT_OF_SERVICE"])("refuses a %s bay", (status) => {
    const d = decideRelease(
      candidate({ locker: { id: "l1", lockerNumber: "2", status, isOperational: true } }),
      NOON,
      POLICY,
    );
    expect(d).toMatchObject({ release: false, code: "bay_not_operational" });
  });

  it("refuses a bay flagged not operational even if its status looks fine", () => {
    const d = decideRelease(
      candidate({ locker: { id: "l1", lockerNumber: "2", status: "OCCUPIED", isOperational: false } }),
      NOON,
      POLICY,
    );
    expect(d).toMatchObject({ release: false, code: "bay_not_operational" });
  });
});

describe("R1 — late collection, the user's 'late for an hour or more'", () => {
  it("releases once the grace period has elapsed", () => {
    expect(decideRelease(candidate(), NOON, POLICY)).toEqual({
      release: true,
      reason: "LATE_COLLECTION",
    });
  });

  it("refuses at 59 minutes and releases at 61, with the default 1h grace", () => {
    const at = (mins: number) =>
      decideRelease(
        candidate({ depositedAt: new Date(NOON.getTime() - mins * 60_000) }),
        NOON,
        POLICY,
      );
    expect(at(59)).toMatchObject({ release: false, code: "grace_not_elapsed" });
    expect(at(61)).toMatchObject({ release: true });
  });

  it("honours an admin-configured grace period", () => {
    const slow = { ...POLICY, collection_grace_hours: 6 };
    expect(
      decideRelease(candidate({ depositedAt: new Date(NOON.getTime() - 3 * 3_600_000) }), NOON, slow),
    ).toMatchObject({ release: false, code: "grace_not_elapsed" });
  });

  it("refuses a DEPOSITED rental with no depositedAt rather than guessing", () => {
    expect(decideRelease(candidate({ depositedAt: null }), NOON, POLICY)).toMatchObject({
      release: false,
      code: "no_deposit_timestamp",
    });
  });
});

describe("F10 — the release window, the user's 'specific hour of the day'", () => {
  const at = (h: number) => new Date(2026, 8, 12, h, 0, 0);

  it("refuses outside the window and allows inside it", () => {
    const late = candidate({ depositedAt: new Date(at(3).getTime() - 5 * 3_600_000) });
    expect(decideRelease(late, at(3), POLICY)).toMatchObject({
      release: false,
      code: "outside_release_window",
    });
    expect(decideRelease(late, at(9), POLICY)).toMatchObject({ release: true });
  });

  it("treats the window as inclusive start, exclusive end", () => {
    expect(isWithinReleaseWindow(at(7), POLICY)).toBe(true);
    expect(isWithinReleaseWindow(at(20), POLICY)).toBe(true);
    expect(isWithinReleaseWindow(at(21), POLICY)).toBe(false);
  });

  it("handles a window that wraps midnight", () => {
    // The naive `h >= start && h < end` is always false for these.
    const night = { ...POLICY, release_window_start_hour: 22, release_window_end_hour: 6 };
    expect(isWithinReleaseWindow(at(23), night)).toBe(true);
    expect(isWithinReleaseWindow(at(2), night)).toBe(true);
    expect(isWithinReleaseWindow(at(12), night)).toBe(false);
  });

  it("a zero-width window means no restriction, not never", () => {
    const always = { ...POLICY, release_window_start_hour: 0, release_window_end_hour: 0 };
    expect(isWithinReleaseWindow(at(3), always)).toBe(true);
  });

  it("an owner collecting in person is not blocked by the window", () => {
    const d = decideRelease(candidate({ status: "VERIFICATION" }), at(3), POLICY, {
      onDemand: true,
    });
    expect(d).toEqual({ release: true, reason: "OWNER_RETURN_PICKUP" });
  });
});

describe("the auto-release switch", () => {
  it("stops scheduled releases but not an owner standing at the kiosk", () => {
    const off = { ...POLICY, auto_release_enabled: false };
    expect(decideRelease(candidate(), NOON, off)).toMatchObject({
      release: false,
      code: "auto_release_disabled",
    });
    expect(
      decideRelease(candidate({ status: "VERIFICATION" }), NOON, off, { onDemand: true }),
    ).toMatchObject({ release: true });
  });
});

describe("R3/R4/R5 — event-driven releases wait for no grace period", () => {
  it.each([
    ["VERIFICATION", "OWNER_RETURN_PICKUP"],
    ["CANCELLED", "CANCELLED_WITH_ITEM"],
    ["DISPUTED", "RETURN_DISPUTED"],
  ])("%s releases immediately inside the window", (status, reason) => {
    expect(
      decideRelease(candidate({ status, depositedAt: NOON }), NOON, POLICY),
    ).toEqual({ release: true, reason });
  });

  it("refuses a rental with no bay on record", () => {
    expect(decideRelease(candidate({ locker: null }), NOON, POLICY)).toMatchObject({
      release: false,
      code: "no_locker",
    });
  });

  it("refuses a status with no release path", () => {
    expect(decideRelease(candidate({ status: "ACTIVE" }), NOON, POLICY)).toMatchObject({
      release: false,
      code: "status_has_no_release",
    });
  });
});

describe("F6 — escalation when nobody collects", () => {
  it("escalates only after the configured deadline, and never once collected", () => {
    const released = new Date(NOON.getTime() - 80 * 3_600_000);
    expect(needsRetrievalEscalation(released, null, NOON, POLICY)).toBe(true);
    expect(needsRetrievalEscalation(released, NOON, NOON, POLICY)).toBe(false);
    expect(
      needsRetrievalEscalation(new Date(NOON.getTime() - 10 * 3_600_000), null, NOON, POLICY),
    ).toBe(false);
    expect(needsRetrievalEscalation(null, null, NOON, POLICY)).toBe(false);
  });
});

describe("F3 — a drop commanded and never acknowledged", () => {
  it("flags a stale request, and not a fresh or completed one", () => {
    const asked = new Date(NOON.getTime() - 5 * 60_000);
    expect(isUnacknowledgedRelease(asked, null, NOON)).toBe(true);
    expect(isUnacknowledgedRelease(asked, NOON, NOON)).toBe(false);
    expect(isUnacknowledgedRelease(new Date(NOON.getTime() - 5_000), null, NOON)).toBe(false);
    expect(isUnacknowledgedRelease(null, null, NOON)).toBe(false);
  });
});

describe("readRetrievalPolicy — admin config, defensively", () => {
  it("falls back completely when the blob has no retrieval section", () => {
    expect(readRetrievalPolicy({})).toEqual(DEFAULT_RETRIEVAL_POLICY);
    expect(readRetrievalPolicy(null)).toEqual(DEFAULT_RETRIEVAL_POLICY);
    expect(readRetrievalPolicy("nonsense")).toEqual(DEFAULT_RETRIEVAL_POLICY);
  });

  it("takes admin values when they are sane", () => {
    const p = readRetrievalPolicy({
      retrieval: { collection_grace_hours: 2, auto_release_enabled: false },
    });
    expect(p.collection_grace_hours).toBe(2);
    expect(p.auto_release_enabled).toBe(false);
    expect(p.release_window_start_hour).toBe(7); // untouched fields keep defaults
  });

  it("rejects nonsense values per-field rather than adopting them", () => {
    // A negative grace period would release every item the instant it landed.
    const p = readRetrievalPolicy({
      retrieval: {
        collection_grace_hours: -5,
        release_window_start_hour: "seven",
        owner_retrieval_deadline_hours: Number.NaN,
      },
    });
    expect(p.collection_grace_hours).toBe(1);
    expect(p.release_window_start_hour).toBe(7);
    expect(p.owner_retrieval_deadline_hours).toBe(72);
  });
});
