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
  | "qr"
  | "confirm"
  | "face"
  | "verifying"
  | "success"
  | "error";

/** Screens that are informational only — no rental in flight, safe to leave
 *  at any time, and returning from them goes to "main" rather than unwinding
 *  a transaction. */
export const INFO_SCREENS: Screen[] = ["how", "catalogue", "lockers"];

/** Screens a user can be sitting on when their phone scans the kiosk QR — the
 *  code is rendered on "main", and they may have wandered into an info screen
 *  or let the display fall back to "idle" before scanning. A "qr_scanned"
 *  event arriving on any of these is legitimate and should open "confirm";
 *  arriving on a flow screen ("face"/"verifying"/"success") is a late or
 *  duplicate event and must be ignored so it cannot interrupt a live scan. */
export const PRE_FLOW_SCREENS: Screen[] = [
  "idle",
  "main",
  ...INFO_SCREENS,
  "qr",
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

export interface KioskServerState {
  status?: string;
  message?: string;
  lockers?: Record<string, LockerDoors>;
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
