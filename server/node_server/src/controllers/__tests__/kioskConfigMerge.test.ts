import { __testables } from "../adminController";

const { deepMerge, DEFAULT_CONFIG } = __testables;

/**
 * D-72 regression.
 *
 * The Pi's `on_config` handler REPLACES `kiosk_config.json` wholesale whenever
 * the pushed payload contains a `lockers` key. Two things therefore have to
 * hold, forever, or an admin pressing save in the console silently
 * de-calibrates real hardware:
 *
 *   1. the server never invents per-bay timings, and
 *   2. a config update merges rather than replaces.
 *
 * The real calibration, twice-verified against the hardware and the reason
 * CLAUDE.md forbids touching it:
 *   bay 1: 15/15/22/22   bay 2: 5/5/21/21
 *   bay 3: 15/15/17/17   bay 4: 15/15/23/23
 */
const REAL_CALIBRATION = {
  lockers: {
    "1": { main_door_open_seconds: 15, bottom_door_open_seconds: 15, actuator_extend_seconds: 22, actuator_retract_seconds: 22 },
    "2": { main_door_open_seconds: 5, bottom_door_open_seconds: 5, actuator_extend_seconds: 21, actuator_retract_seconds: 21 },
    "3": { main_door_open_seconds: 15, bottom_door_open_seconds: 15, actuator_extend_seconds: 17, actuator_retract_seconds: 17 },
    "4": { main_door_open_seconds: 15, bottom_door_open_seconds: 15, actuator_extend_seconds: 23, actuator_retract_seconds: 23 },
  },
};

describe("D-72 — the server must not be able to de-calibrate the kiosk", () => {
  it("ships NO per-bay timing defaults at all", () => {
    // The old defaults were 15/15/5/5 for all four bays. Any `lockers` key
    // here is an instruction to the Pi to overwrite its calibration file.
    expect(DEFAULT_CONFIG).not.toHaveProperty("lockers");
  });

  it("carries the E4.6 retrieval policy the user ruled on", () => {
    expect(DEFAULT_CONFIG.retrieval).toEqual({
      auto_release_enabled: true,
      collection_grace_hours: 1,
      release_window_start_hour: 7,
      release_window_end_hour: 21,
      owner_retrieval_deadline_hours: 72,
    });
  });

  it("preserves stored calibration when an unrelated key is updated", () => {
    // The exact scenario: an admin changes the grace period and saves.
    const merged = deepMerge(REAL_CALIBRATION as never, {
      retrieval: { collection_grace_hours: 3 },
    });
    expect(merged.lockers).toEqual(REAL_CALIBRATION.lockers);
    expect((merged.retrieval as Record<string, unknown>).collection_grace_hours).toBe(3);
  });

  it("merges nested objects instead of replacing them wholesale", () => {
    const merged = deepMerge(
      { retrieval: { collection_grace_hours: 1, auto_release_enabled: true } },
      { retrieval: { collection_grace_hours: 6 } },
    );
    // auto_release_enabled must survive a patch that never mentioned it.
    expect(merged.retrieval).toEqual({
      collection_grace_hours: 6,
      auto_release_enabled: true,
    });
  });

  it("still lets a deliberate, explicit per-bay timing change through", () => {
    // Merging is not a veto. An admin who genuinely means to retime bay 3 can,
    // and only bay 3 moves.
    const merged = deepMerge(REAL_CALIBRATION as never, {
      lockers: { "3": { main_door_open_seconds: 20 } },
    });
    const lockers = merged.lockers as Record<string, Record<string, number>>;
    expect(lockers["3"].main_door_open_seconds).toBe(20);
    expect(lockers["3"].actuator_extend_seconds).toBe(17); // untouched
    expect(lockers["2"].main_door_open_seconds).toBe(5); // bay 2 stays at 5s
  });

  it("replaces arrays and scalars rather than merging them", () => {
    expect(deepMerge({ a: [1, 2, 3] }, { a: [9] })).toEqual({ a: [9] });
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
    expect(deepMerge({ a: { b: 1 } }, { a: null })).toEqual({ a: null });
  });
});
