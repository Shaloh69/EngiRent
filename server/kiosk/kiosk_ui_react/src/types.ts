export type Screen =
  | "idle"
  | "main"
  // Informational screens reachable from the main menu. They carry the
  // promotional role the mandate gives this surface (§4) — the kiosk stands
  // in a corridor and is the only EngiRent touchpoint most passers-by will
  // ever see, so it explains the service, not just the transaction.
  | "how"
  | "catalogue"
  | "lockers"
  | "face"
  | "verifying"
  // E3.2 / spec 1.1. The hardware waits -- door_open, dropping, capturing.
  // The Pi has emitted these statuses all along and the UI branched on none
  // of them, so a 15s door (lockers 1/3/4) or a 34-46s actuator sequence
  // happened with the main menu on screen.
  | "working"
  | "success"
  | "error";

/** Screens that are informational only — no rental in flight, safe to leave
 *  at any time, and returning from them goes to "main" rather than unwinding
 *  a transaction. */
export const INFO_SCREENS: Screen[] = ["how", "catalogue", "lockers"];

/** Screens a user can be sitting on before a rental flow starts. Retained for
 *  guard checks on in-flight events: arriving on a flow screen
 *  ("face"/"verifying"/"success") means a late or duplicate event that must not
 *  interrupt a live session.
 *
 *  The "qr"/"confirm" screens that used to be in this list were removed
 *  2026-09-06. They belonged to the reversed hand-off (kiosk scanning a code on
 *  the phone), whose camera was physically removed 2026-09-03 along with the
 *  QR-decode loop that emitted `qr_scanned` — leaving the states, and the
 *  deadlock fix written for them the same day, permanently unreachable. */
export const PRE_FLOW_SCREENS: Screen[] = ["idle", "main", ...INFO_SCREENS];

/**
 * Screens that belong to a transaction in flight. When the Pi reports it is
 * "online" again (no flow in progress), a kiosk still showing one of these is
 * showing a flow that has ended, and returns to "main" for the next person.
 * The complement of PRE_FLOW_SCREENS — kept explicit rather than derived so a
 * new screen has to be classified deliberately.
 */
export const FLOW_SCREENS: Screen[] = [
  "face",
  "verifying",
  "working",
  "success",
  "error",
];

export type Mode = "place" | "retrieve" | null;

export interface RentalInfo {
  item?: { title?: string; name?: string };
  owner?: { firstName?: string; lastName?: string };
  status?: string;
  depositLockerId?: string | number;
}

export interface LockerDoors {
  main?: "locked" | "unlocked";
  bottom?: "locked" | "unlocked";
}

/** Server-side LockerStatus. D-53: this is OCCUPANCY, not door state. */
export type LockerOccupancy =
  | "AVAILABLE"
  | "OCCUPIED"
  | "RESERVED"
  | "MAINTENANCE"
  | "OUT_OF_SERVICE";

export interface KioskServerState {
  status?: string;
  message?: string;
  /**
   * Increments on every state change the Pi makes. The screen polls every 2s,
   * and without this it could not tell a NEW state from the same one polled
   * again — so it kept re-applying finished flows (the "kiosk keeps
   * repeating" defect) and undid Cancel within two seconds.
   */
  seq?: number;
  /**
   * E3.2 / spec 1.1. The REAL duration of the operation now running, in
   * seconds, as decided by the handler that is actually driving the
   * hardware -- not looked up from a config table here.
   *
   * That distinction is load-bearing: the admin console can send a
   * `duration_override` (adminController.ts:1178), so a UI-side lookup of
   * `main_door_open_seconds` would silently disagree with the door in front
   * of the person watching the bar.
   *
   * ABSENT means unknown, and unknown must render as INDETERMINATE -- never
   * as a guessed duration. A canned animation over a hardware wait is the
   * one thing ANIMATION-AND-LOADING-SPEC.md 1.1 bans outright. Same rule as
   * D-53: absent is not a licence to invent a value.
   */
  duration_seconds?: number;
  /** DOOR state only — "unlocked" means physically open right now. */
  lockers?: Record<string, LockerDoors>;
  /**
   * D-53. Per-bay LockerStatus from the server. ABSENT until the server sends
   * it, and absent must be read as UNKNOWN — never as available. The screen
   * that reports free bays has to say it does not know rather than guess,
   * because guessing wrong sends a student to a door that is not free.
   */
  occupancy?: Record<string, LockerOccupancy | string>;
  active_locker?: number | string;
}

/** A listing shown in the kiosk catalogue. Mirrors the fields the API's
 *  item payload already returns; the kiosk only ever reads these. */
export interface CatalogueItem {
  id: string;
  title: string;
  category?: string;
  pricePerDay?: number;
  securityDeposit?: number;
  images?: string[];
  isAvailable?: boolean;
}
