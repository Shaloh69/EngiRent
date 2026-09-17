/**
 * D-86: the console now POLLS for an admin snapshot, because the live event
 * stream never reaches the browser through the Cloudflare tunnel (measured:
 * first event at ~66ms on localhost, nothing through the tunnel in 35s).
 */
import {
  recordAdminSnapshot,
  getLatestAdminSnapshot,
  _clearAdminSnapshots,
} from "../kioskSnapshotStore";
import { recordKioskLog, getKioskLogs, clearKioskLogs } from "../kioskLogBuffer";

describe("kioskSnapshotStore", () => {
  beforeEach(() => _clearAdminSnapshots());

  it("keeps the newest snapshot per locker", () => {
    recordAdminSnapshot({ kiosk_id: "KIOSK-001", locker_id: 1, image_urls: ["a.jpg"] });
    recordAdminSnapshot({ kiosk_id: "KIOSK-001", locker_id: 1, image_urls: ["b.jpg"] });
    expect(getLatestAdminSnapshot("1")?.imageUrls).toEqual(["b.jpg"]);
  });

  it("normalises the bay number, so '01' and 1 are the same locker", () => {
    recordAdminSnapshot({ locker_id: "01", image_urls: ["a.jpg"] });
    expect(getLatestAdminSnapshot("1")?.imageUrls).toEqual(["a.jpg"]);
  });

  it("records an EMPTY capture, because the console must be able to say so (D-85)", () => {
    const snap = recordAdminSnapshot({ locker_id: 2, image_urls: [] });
    expect(snap?.imageUrls).toEqual([]);
    expect(getLatestAdminSnapshot("2")).not.toBeNull();
  });

  it("drops non-string urls and rejects a missing or bad bay", () => {
    expect(recordAdminSnapshot({ locker_id: 3, image_urls: ["ok.jpg", 5, null] })?.imageUrls).toEqual([
      "ok.jpg",
    ]);
    expect(recordAdminSnapshot({ image_urls: ["x.jpg"] })).toBeNull();
    expect(recordAdminSnapshot({ locker_id: "abc", image_urls: ["x.jpg"] })).toBeNull();
  });

  it("with `since`, hides a snapshot older than the request — the stale-photo trap", () => {
    const snap = recordAdminSnapshot({ locker_id: 4, image_urls: ["old.jpg"] })!;
    expect(getLatestAdminSnapshot("4", snap.ts + 1)).toBeNull();
    expect(getLatestAdminSnapshot("4", snap.ts)).not.toBeNull();
  });

  it("returns null for a bay nobody photographed", () => {
    expect(getLatestAdminSnapshot("1")).toBeNull();
  });
});

describe("kioskLogBuffer — since (polling)", () => {
  beforeEach(() => clearKioskLogs());

  it("returns only lines strictly newer than `since`", () => {
    for (const ts of [100, 200, 300]) {
      recordKioskLog({ kiosk_id: "K", level: "INFO", module: "m", message: `t${ts}`, ts });
    }
    expect(getKioskLogs(undefined, undefined, 200).map((l) => l.message)).toEqual(["t300"]);
    expect(getKioskLogs(undefined, undefined, 300)).toEqual([]);
    expect(getKioskLogs(undefined, undefined, undefined)).toHaveLength(3);
  });
});
