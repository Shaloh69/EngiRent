/**
 * The admin console's Live Pi Logs panel opens with this backlog. Before it
 * existed the panel started empty on every page load and stayed empty while
 * the kiosk was idle, which the user reported as "the raspi logs don't
 * reflect here" (2026-09-17).
 */
import {
  recordKioskLog,
  getKioskLogs,
  clearKioskLogs,
  MAX_LINES,
} from "../kioskLogBuffer";

const line = (n: number, kiosk_id = "KIOSK-001") => ({
  kiosk_id,
  level: "INFO",
  module: "kiosk.socket",
  message: `line ${n}`,
  ts: 1_000 + n,
});

describe("kioskLogBuffer", () => {
  beforeEach(() => clearKioskLogs());

  it("starts empty — a restart must not replay stale lines as if new", () => {
    expect(getKioskLogs()).toEqual([]);
  });

  it("keeps lines newest-last, the order the panel appends in", () => {
    recordKioskLog(line(1));
    recordKioskLog(line(2));
    expect(getKioskLogs().map((l) => l.message)).toEqual(["line 1", "line 2"]);
  });

  it("caps at MAX_LINES, dropping the oldest", () => {
    for (let i = 1; i <= MAX_LINES + 25; i++) recordKioskLog(line(i));
    const all = getKioskLogs();
    expect(all).toHaveLength(MAX_LINES);
    expect(all[0].message).toBe("line 26");
    expect(all[all.length - 1].message).toBe(`line ${MAX_LINES + 25}`);
  });

  it("limit returns the most recent N, and a bad limit returns everything", () => {
    for (let i = 1; i <= 10; i++) recordKioskLog(line(i));
    expect(getKioskLogs(3).map((l) => l.message)).toEqual(["line 8", "line 9", "line 10"]);
    expect(getKioskLogs(0)).toHaveLength(10);
    expect(getKioskLogs(-5)).toHaveLength(10);
    expect(getKioskLogs(999)).toHaveLength(10);
  });

  it("scopes to one kiosk when asked", () => {
    recordKioskLog(line(1, "KIOSK-001"));
    recordKioskLog(line(2, "KIOSK-002"));
    recordKioskLog(line(3, "KIOSK-001"));
    expect(getKioskLogs(undefined, "KIOSK-001").map((l) => l.message)).toEqual([
      "line 1",
      "line 3",
    ]);
  });

  it("hands out a copy, so a caller cannot rewrite the history", () => {
    recordKioskLog(line(1));
    const out = getKioskLogs();
    out.pop();
    expect(getKioskLogs()).toHaveLength(1);
  });
});
