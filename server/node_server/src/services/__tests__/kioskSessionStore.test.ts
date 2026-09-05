/**
 * E1 — the kiosk session store IS the trust boundary, so it gets attacked,
 * not just exercised.
 *
 * Everything downstream of `POST /kiosk/verify-face` — including the command
 * that physically opens a locker door — trusts a record in this module and
 * nothing the phone sends. `API-TEST-PLAN.md` names three properties as
 * specifically risky; each is asserted here against the real module (no mocks,
 * it is pure in-memory state):
 *
 *   1. the 120 s TTL actually expires a session
 *   2. the 4-attempt cap actually forces a re-scan
 *   3. a verified session is single-use — it cannot open a second door
 *
 * Timers are faked because the alternative is a test that sleeps two minutes,
 * and a suite nobody runs proves nothing.
 */
import {
  openKioskSession,
  getKioskSession,
  consumeKioskSession,
  recordFailedFaceAttempt,
} from "../kioskSessionStore";

const RENTAL = "rental-1";
const KIOSK = "KIOSK-001";
const USER = "user-1";

describe("kioskSessionStore — TTL", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    consumeKioskSession(RENTAL);
  });
  afterEach(() => {
    consumeKioskSession(RENTAL);
    jest.useRealTimers();
  });

  it("returns the session the kiosk opened, with the kiosk's own id", () => {
    openKioskSession(RENTAL, KIOSK, USER);

    const session = getKioskSession(RENTAL);
    expect(session).toBeDefined();
    // The whole point: kioskId comes from here, never from the request body.
    expect(session?.kioskId).toBe(KIOSK);
    expect(session?.userId).toBe(USER);
    expect(session?.attempts).toBe(0);
  });

  it("still returns the session one millisecond before the 120 s TTL", () => {
    openKioskSession(RENTAL, KIOSK, USER);

    jest.advanceTimersByTime(119_999);

    expect(getKioskSession(RENTAL)).toBeDefined();
  });

  it("treats a session as absent the moment the 120 s TTL elapses", () => {
    openKioskSession(RENTAL, KIOSK, USER);

    jest.advanceTimersByTime(120_000);

    // Absent, not stale — a caller must not be able to read an expired record
    // and decide for itself whether it is still good enough.
    expect(getKioskSession(RENTAL)).toBeUndefined();
  });

  it("never returns a session for a rental nobody scanned for", () => {
    expect(getKioskSession("rental-nobody-scanned")).toBeUndefined();
  });

  it("keeps sessions per rental — opening one does not reveal another", () => {
    openKioskSession(RENTAL, KIOSK, USER);

    expect(getKioskSession("rental-2")).toBeUndefined();

    consumeKioskSession(RENTAL);
  });
});

describe("kioskSessionStore — single use", () => {
  afterEach(() => consumeKioskSession(RENTAL));

  it("cannot open a second door after a verified match consumed it", () => {
    openKioskSession(RENTAL, KIOSK, USER);
    expect(getKioskSession(RENTAL)).toBeDefined();

    consumeKioskSession(RENTAL);

    expect(getKioskSession(RENTAL)).toBeUndefined();
  });
});

describe("kioskSessionStore — failed-attempt cap", () => {
  afterEach(() => consumeKioskSession(RENTAL));

  it("allows three failures, then exhausts the session on the fourth", () => {
    openKioskSession(RENTAL, KIOSK, USER);

    expect(recordFailedFaceAttempt(RENTAL)).toEqual({
      exhausted: false,
      attemptsRemaining: 3,
    });
    expect(recordFailedFaceAttempt(RENTAL)).toEqual({
      exhausted: false,
      attemptsRemaining: 2,
    });
    expect(recordFailedFaceAttempt(RENTAL)).toEqual({
      exhausted: false,
      attemptsRemaining: 1,
    });

    // Fourth failure: the session is gone, not merely flagged — the next
    // request has to come back through a real kiosk scan.
    expect(recordFailedFaceAttempt(RENTAL)).toEqual({
      exhausted: true,
      attemptsRemaining: 0,
    });
    expect(getKioskSession(RENTAL)).toBeUndefined();
  });

  it("reports exhausted for a rental with no session at all", () => {
    // A caller hammering a rental id it never scanned for must be told to
    // rescan, not handed a fresh attempt budget.
    expect(recordFailedFaceAttempt("rental-never-opened")).toEqual({
      exhausted: true,
      attemptsRemaining: 0,
    });
  });

  it("gives a re-scan a fresh budget, and no more than one", () => {
    openKioskSession(RENTAL, KIOSK, USER);
    recordFailedFaceAttempt(RENTAL);
    recordFailedFaceAttempt(RENTAL);

    // Re-scanning at the kiosk is a genuine new session.
    openKioskSession(RENTAL, KIOSK, USER);
    expect(getKioskSession(RENTAL)?.attempts).toBe(0);

    expect(recordFailedFaceAttempt(RENTAL)).toEqual({
      exhausted: false,
      attemptsRemaining: 3,
    });
  });
});
