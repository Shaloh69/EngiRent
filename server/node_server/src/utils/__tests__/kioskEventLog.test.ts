import kioskEventBus from "../kioskEventBus";
import { installKioskEventLog, getRecentKioskEvents } from "../kioskEventLog";

/**
 * A KIOSK_PROBLEM feedback report is only useful if the snapshot it carries
 * actually reflects what the kiosk did. This can't be exercised over HTTP —
 * there's no real kiosk socket connection in an API-level test, and adding
 * socket.io-client as a dependency just to simulate one would be a heavier
 * cost than testing the ring buffer directly, in-process, against the exact
 * event names index.ts really emits.
 */
describe("kioskEventLog", () => {
  beforeAll(() => {
    installKioskEventLog();
  });

  it("is idempotent — installing twice does not duplicate recorded events", () => {
    installKioskEventLog(); // second call, same process
    kioskEventBus.emit("kiosk_status", { kiosk_id: "kiosk-idem-test", ts: Date.now() });
    const events = getRecentKioskEvents("kiosk-idem-test");
    expect(events).toHaveLength(1);
  });

  it("records an event and returns it most-recent-last", () => {
    const kioskId = `kiosk-test-${Date.now()}`;
    kioskEventBus.emit("kiosk_online", { kiosk_id: kioskId, ts: 1000 });
    kioskEventBus.emit("kiosk_status", { kiosk_id: kioskId, ts: 2000 });
    kioskEventBus.emit("kiosk_error", { kiosk_id: kioskId, ts: 3000, message: "locker jam" });

    const events = getRecentKioskEvents(kioskId);
    expect(events.map((e) => e.type)).toEqual(["kiosk_online", "kiosk_status", "kiosk_error"]);
    expect(events[2].data).toMatchObject({ message: "locker jam" });
  });

  it("keeps kiosks separate — one kiosk's events never leak into another's report", () => {
    const kioskA = `kiosk-a-${Date.now()}`;
    const kioskB = `kiosk-b-${Date.now()}`;
    kioskEventBus.emit("kiosk_status", { kiosk_id: kioskA, ts: 1 });
    kioskEventBus.emit("kiosk_status", { kiosk_id: kioskB, ts: 1 });
    kioskEventBus.emit("kiosk_status", { kiosk_id: kioskB, ts: 2 });

    expect(getRecentKioskEvents(kioskA)).toHaveLength(1);
    expect(getRecentKioskEvents(kioskB)).toHaveLength(2);
  });

  it("ignores events with no kiosk_id rather than bucketing them under a fake key", () => {
    kioskEventBus.emit("kiosk_status", { ts: Date.now() });
    // Should not throw, and should not create an "undefined" bucket that a
    // later real kiosk could accidentally collide with.
    expect(getRecentKioskEvents("undefined")).toHaveLength(0);
  });

  it("caps the buffer instead of growing without bound for a chatty kiosk", () => {
    const kioskId = `kiosk-cap-${Date.now()}`;
    for (let i = 0; i < 80; i++) {
      kioskEventBus.emit("kiosk_log", { kiosk_id: kioskId, ts: i, seq: i });
    }
    const events = getRecentKioskEvents(kioskId, 100);
    expect(events.length).toBeLessThanOrEqual(40); // MAX_EVENTS_PER_KIOSK
    // The oldest entries were dropped, not the newest — a report should see
    // what just happened, not what happened first.
    expect((events[events.length - 1].data as { seq: number }).seq).toBe(79);
  });

  it("a report asking for fewer events than exist gets the most recent ones", () => {
    const kioskId = `kiosk-limit-${Date.now()}`;
    for (let i = 0; i < 10; i++) {
      kioskEventBus.emit("kiosk_status", { kiosk_id: kioskId, ts: i, seq: i });
    }
    const events = getRecentKioskEvents(kioskId, 3);
    expect(events.map((e) => (e.data as { seq: number }).seq)).toEqual([7, 8, 9]);
  });

  it("an untracked kiosk returns an empty array, not null or undefined — safe to iterate", () => {
    expect(getRecentKioskEvents("kiosk-never-seen")).toEqual([]);
  });
});
