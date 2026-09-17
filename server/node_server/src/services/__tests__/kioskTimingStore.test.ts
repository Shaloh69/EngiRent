/**
 * What the admin console shows as a locker's REAL timing, and what the phone
 * counts down while a door is unlocked, both come from this store (D-82, D-83).
 * A bad value shown as real is worse than an honest "unknown", so these tests
 * are mostly about what gets rejected.
 */
import {
  sanitiseLockers,
  recordTimingReport,
  getTimingReport,
  doorOpenSeconds,
  _clearTimingReports,
} from "../kioskTimingStore";

// The live Pi's kiosk_config.json, as read on 2026-09-14.
const REAL = {
  "1": { main_door_open_seconds: 15, bottom_door_open_seconds: 15, actuator_extend_seconds: 22, actuator_retract_seconds: 22 },
  "2": { main_door_open_seconds: 5, bottom_door_open_seconds: 5, actuator_extend_seconds: 21, actuator_retract_seconds: 21 },
  "3": { main_door_open_seconds: 15, bottom_door_open_seconds: 15, actuator_extend_seconds: 17, actuator_retract_seconds: 17 },
  "4": { main_door_open_seconds: 15, bottom_door_open_seconds: 15, actuator_extend_seconds: 23, actuator_retract_seconds: 23 },
};

describe("kioskTimingStore", () => {
  beforeEach(() => _clearTimingReports());

  it("accepts the real calibration file unchanged", () => {
    expect(sanitiseLockers(REAL)).toEqual(REAL);
  });

  it("drops a whole bay when any one field is bad, rather than half-showing it", () => {
    const out = sanitiseLockers({
      ...REAL,
      "2": { ...REAL["2"], actuator_extend_seconds: "21" }, // string, not number
      "3": { ...REAL["3"], main_door_open_seconds: -1 },
      "4": { ...REAL["4"], bottom_door_open_seconds: 9999 },
    });
    expect(Object.keys(out)).toEqual(["1"]);
  });

  it("drops a bay with a missing field, zero, NaN or Infinity", () => {
    const { actuator_retract_seconds: _omit, ...missing } = REAL["1"];
    expect(sanitiseLockers({ "1": missing })).toEqual({});
    expect(sanitiseLockers({ "1": { ...REAL["1"], main_door_open_seconds: 0 } })).toEqual({});
    expect(sanitiseLockers({ "1": { ...REAL["1"], main_door_open_seconds: NaN } })).toEqual({});
    expect(sanitiseLockers({ "1": { ...REAL["1"], main_door_open_seconds: Infinity } })).toEqual({});
  });

  it("ignores keys that are not bay numbers, and non-objects", () => {
    expect(sanitiseLockers({ solenoid_pins: REAL["1"], "1x": REAL["1"] })).toEqual({});
    expect(sanitiseLockers(null)).toEqual({});
    expect(sanitiseLockers("lockers")).toEqual({});
  });

  it("records nothing when no bay survives, so the console stays 'unknown'", () => {
    expect(recordTimingReport("KIOSK-001", { "1": { main_door_open_seconds: "x" } })).toBeNull();
    expect(getTimingReport("KIOSK-001")).toBeUndefined();
  });

  it("serves the latest report per kiosk", () => {
    recordTimingReport("KIOSK-001", REAL);
    const r = getTimingReport("KIOSK-001");
    expect(r?.lockers["2"].main_door_open_seconds).toBe(5);
    expect(typeof r?.reportedAt).toBe("number");
    expect(getTimingReport("KIOSK-999")).toBeUndefined();
  });

  it("gives the phone bay 2's real 5 seconds, not the old hardcoded 15 (D-82)", () => {
    recordTimingReport("KIOSK-001", REAL);
    expect(doorOpenSeconds("KIOSK-001", "2", "main_door")).toBe(5);
    expect(doorOpenSeconds("KIOSK-001", "4", "main_door")).toBe(15);
    expect(doorOpenSeconds("KIOSK-001", "02", "bottom_door")).toBe(5);
  });

  it("returns undefined, not a guess, before the kiosk has reported", () => {
    expect(doorOpenSeconds("KIOSK-001", "2", "main_door")).toBeUndefined();
  });
});
