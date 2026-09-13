/**
 * The grant is what stands between a phone tap and a door opening on an
 * unattended kiosk in a public corridor, so these tests are about refusal:
 * who is turned away, and when.
 *
 * Context (2026-09-14): the server used to open the door itself the moment a
 * face verified, then photograph the bay 20s later on a timer. A person still
 * reading their phone missed the window, and a RETRY verdict re-opened the
 * door with no second photo ever scheduled — D-78, seen on real hardware.
 * Both steps became taps, and this store is what makes a tap safe.
 */
import {
  grantBayAccess,
  getBayAccess,
  revokeBayAccess,
  noteOpen,
  noteCapture,
  isExpired,
  _clearAllBayAccess,
  BAY_ACCESS_TTL_MS,
  MAX_OPENS,
  MAX_CAPTURES,
} from "../kioskBayAccessStore";

const base = {
  rentalId: "rental-1",
  userId: "owner-1",
  kioskId: "KIOSK-001",
  action: "deposit" as const,
  lockerNumber: "4",
  door: "main_door" as const,
};

describe("kioskBayAccessStore", () => {
  beforeEach(() => {
    _clearAllBayAccess();
    jest.useRealTimers();
  });

  it("hands back exactly what the hardware call needs, and nothing from the client", () => {
    const grant = grantBayAccess(base);
    expect(grant.kioskId).toBe("KIOSK-001");
    expect(grant.lockerNumber).toBe("4");
    expect(grant.door).toBe("main_door");
    expect(grant.opens).toBe(0);
    expect(grant.captures).toBe(0);
    expect(grant.expiresAt - grant.createdAt).toBe(BAY_ACCESS_TTL_MS);
  });

  it("is unknown for a rental nobody verified a face for", () => {
    expect(getBayAccess("never-scanned")).toBeUndefined();
  });

  it("expires, and an expired grant reads as absent rather than stale", () => {
    const grant = grantBayAccess(base);
    expect(isExpired(grant, grant.expiresAt - 1)).toBe(false);
    expect(isExpired(grant, grant.expiresAt)).toBe(true);

    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + BAY_ACCESS_TTL_MS + 1);
    expect(getBayAccess(base.rentalId)).toBeUndefined();
    // A door must never open on the strength of an expired grant.
    expect(noteOpen(base.rentalId)).toEqual({ ok: false, reason: "expired" });
    expect(noteCapture(base.rentalId)).toEqual({ ok: false, reason: "expired" });
  });

  it("a re-scan replaces the old grant rather than adding a second one", () => {
    grantBayAccess(base);
    noteOpen(base.rentalId);
    const second = grantBayAccess({ ...base, lockerNumber: "2" });
    const live = getBayAccess(base.rentalId);
    expect(live?.lockerNumber).toBe("2");
    // The counters start again with the new proof, not carried over.
    expect(live?.opens).toBe(0);
    expect(live?.createdAt).toBe(second.createdAt);
  });

  it("counts every open and refuses past the cap", () => {
    grantBayAccess(base);
    for (let i = 1; i <= MAX_OPENS; i++) {
      const r = noteOpen(base.rentalId);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.grant.opens).toBe(i);
    }
    expect(noteOpen(base.rentalId)).toEqual({ ok: false, reason: "too_many_opens" });
  });

  it("counts captures separately from opens, with its own cap", () => {
    grantBayAccess(base);
    noteOpen(base.rentalId);
    for (let i = 1; i <= MAX_CAPTURES; i++) {
      const r = noteCapture(base.rentalId);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.grant.captures).toBe(i);
    }
    expect(noteCapture(base.rentalId)).toEqual({ ok: false, reason: "too_many_captures" });
    // Opens are unaffected by capture exhaustion: the person still has to be
    // able to open the door and take their item back out.
    expect(noteOpen(base.rentalId).ok).toBe(true);
  });

  it("allows a full ML retry loop before either cap bites", () => {
    // The ML service permits 10 attempts; a person opening the door and
    // re-placing the item each time must never be stopped by these caps first.
    grantBayAccess(base);
    for (let attempt = 1; attempt <= 10; attempt++) {
      expect(noteOpen(base.rentalId).ok).toBe(true);
      expect(noteCapture(base.rentalId).ok).toBe(true);
    }
  });

  it("revoking ends it immediately", () => {
    grantBayAccess(base);
    revokeBayAccess(base.rentalId);
    expect(getBayAccess(base.rentalId)).toBeUndefined();
  });

  it("keeps grants for different rentals apart", () => {
    grantBayAccess(base);
    grantBayAccess({ ...base, rentalId: "rental-2", userId: "renter-9", lockerNumber: "1" });
    expect(getBayAccess("rental-1")?.userId).toBe("owner-1");
    expect(getBayAccess("rental-2")?.userId).toBe("renter-9");
    expect(getBayAccess("rental-2")?.lockerNumber).toBe("1");
  });
});
