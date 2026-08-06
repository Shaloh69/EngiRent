export type Screen =
  | "idle"
  | "main"
  | "qr"
  | "confirm"
  | "face"
  | "verifying"
  | "success"
  | "error";

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
