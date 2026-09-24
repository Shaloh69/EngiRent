import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * D-96 / §12 — the server's half of "one bay, one process, start to finish".
 *
 * **These tests exist to prove the WIRING, and that is the whole point.**
 * `retrievalPolicy`'s F2 guard — "a hand may be inside, refuse to move this
 * bay" — has had three passing tests since it was written, and could never
 * fire in production, because both of its inputs were dead: `noteDoorOpen`
 * and `noteDoorClosed` were exported and never called by anything, and no
 * caller ever passed `hasLiveKioskSession`. The tests passed by handing the
 * flags in by hand. That is the fifth defect of this exact shape in this
 * codebase, so none of the tests below hand a flag to anything: every one
 * drives the real writer (`openBay`, the Pi's ack, `grantBayAccess`) and then
 * asks the real reader what it sees.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock("../lockerCompartments", () => ({
  setCompartment: jest.fn().mockResolvedValue(undefined),
  compartmentHolding: jest.fn().mockResolvedValue("top"),
  clearBay: jest.fn().mockResolvedValue(undefined),
  setOperational: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../lockerOccupancyService", () => ({
  emitOccupancyForLockerId: jest.fn().mockResolvedValue(undefined),
  emitLockerOccupancy: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../faceVerificationService", () => ({
  completeClaim: jest.fn().mockResolvedValue(undefined),
  completeRetrieval: jest.fn().mockResolvedValue(undefined),
  KIOSK_ACTIONABLE_STATUSES: [],
  resolveFaceSubject: jest.fn(),
  compareFaceWithMl: jest.fn(),
  applyFaceVerificationOutcome: jest.fn(),
}));
jest.mock("../auditLogService", () => ({
  recordAudit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../storageService", () => ({
  signedMediaUrl: jest.fn(),
  saveBuffer: jest.fn(),
  verificationImagePath: jest.fn(),
}));

import prisma from "../../config/database";
import { openBay } from "../../controllers/kioskController";
import {
  grantBayAccess,
  hasLiveGrantOnBay,
  revokeBayAccess,
  _clearAllBayAccess,
} from "../kioskBayAccessStore";
import {
  requestRelease,
  bayBusyWith,
  isDoorOpen,
  noteDoorClosed,
  noteDropStarted,
  noteDropFinished,
  __resetBayActivity,
} from "../retrievalService";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const KIOSK = "KIOSK-001";
const BAY = "1";

function fakeIo() {
  const emit = jest.fn();
  return { io: { to: jest.fn().mockReturnValue({ emit }) } as any, emit };
}

function reqFor(rentalId: string, userId: string, io: any) {
  return {
    user: { userId },
    body: { rentalId },
    app: { get: () => io },
  } as any;
}

function fakeRes() {
  return { json: jest.fn() } as any;
}

/** Puts a live grant in the real store, the way face verification would. */
function grantFor(rentalId: string, userId: string, bay = BAY) {
  return grantBayAccess({
    rentalId,
    userId,
    kioskId: KIOSK,
    action: "claim",
    lockerNumber: bay,
    door: "main_door",
  });
}

async function callOpenBay(rentalId: string, userId: string, io: any) {
  const next = jest.fn();
  await openBay(reqFor(rentalId, userId, io), fakeRes(), next);
  return next;
}

describe("D-96 — the server refuses to command a bay that is busy", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    _clearAllBayAccess();
    __resetBayActivity();
  });

  it("opens the door, and marks the bay busy as it does — the writer that never existed", async () => {
    const { io, emit } = fakeIo();
    grantFor("rental-A", "user-A");

    const next = await callOpenBay("rental-A", "user-A", io);

    expect(next).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      "kiosk:command",
      expect.objectContaining({ action: "open_door", locker_id: 1 }),
    );
    // The point: F2's input is now actually fed by the real code path.
    expect(isDoorOpen(KIOSK, BAY)).toBe(true);
    expect(bayBusyWith(KIOSK, BAY)).toMatchObject({
      kind: "door_open",
      rentalId: "rental-A",
    });
  });

  it("refuses a SECOND person's open on a bay whose door is already open", async () => {
    const { io, emit } = fakeIo();
    grantFor("rental-A", "user-A");
    grantFor("rental-B", "user-B"); // same bay — grants are keyed by rental, so this is possible

    await callOpenBay("rental-A", "user-A", io);
    emit.mockClear();

    const next = await callOpenBay("rental-B", "user-B", io);

    expect(next).toHaveBeenCalledTimes(1);
    expect(String(next.mock.calls[0][0].message)).toMatch(/finishing something/i);
    expect(emit).not.toHaveBeenCalled(); // and NOTHING was sent to the Pi
  });

  it("lets the SAME person tap again while their own door is open", async () => {
    // Their door relocked after 15s and they are still standing there — that
    // is what the 12-open allowance is for, and refusing it would strand them.
    const { io, emit } = fakeIo();
    grantFor("rental-A", "user-A");

    await callOpenBay("rental-A", "user-A", io);
    emit.mockClear();

    const next = await callOpenBay("rental-A", "user-A", io);

    expect(next).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith("kiosk:command", expect.anything());
  });

  it("refuses EVERYONE, including the drop's own rental, while the actuator travels", async () => {
    // The floor of the compartment is moving. There is no version of this
    // that is safe, so ownership of the drop buys nobody an exception.
    const { io, emit } = fakeIo();
    grantFor("rental-A", "user-A");
    noteDropStarted(KIOSK, BAY, "rental-A");

    const next = await callOpenBay("rental-A", "user-A", io);

    expect(next).toHaveBeenCalledTimes(1);
    expect(String(next.mock.calls[0][0].message)).toMatch(/finishing something/i);
    expect(emit).not.toHaveBeenCalled();
  });

  it("frees the bay when the drop is acknowledged", async () => {
    const { io } = fakeIo();
    grantFor("rental-A", "user-A");
    noteDropStarted(KIOSK, BAY, "rental-A");
    noteDropFinished(KIOSK, BAY);

    const next = await callOpenBay("rental-A", "user-A", io);
    expect(next).not.toHaveBeenCalled();
  });

  it("frees the bay when the Pi acks the door — the other half of the loop", async () => {
    const { io } = fakeIo();
    grantFor("rental-A", "user-A");
    grantFor("rental-B", "user-B");

    await callOpenBay("rental-A", "user-A", io);
    expect(isDoorOpen(KIOSK, BAY)).toBe(true);

    // This is what index.ts's kiosk:ack handler calls when the Pi reports the
    // open_door command finished.
    noteDoorClosed(KIOSK, BAY);

    expect(isDoorOpen(KIOSK, BAY)).toBe(false);
    const next = await callOpenBay("rental-B", "user-B", io);
    expect(next).not.toHaveBeenCalled();
  });

  it("does not let one bay's activity block a different bay", async () => {
    const { io } = fakeIo();
    grantFor("rental-A", "user-A", "1");
    grantFor("rental-C", "user-C", "3");

    await callOpenBay("rental-A", "user-A", io);
    const next = await callOpenBay("rental-C", "user-C", io);

    expect(next).not.toHaveBeenCalled();
    expect(isDoorOpen(KIOSK, "1")).toBe(true);
    expect(isDoorOpen(KIOSK, "3")).toBe(true);
  });
});

describe("D-96 — a lost acknowledgement must not brick a bay", () => {
  beforeEach(() => {
    _clearAllBayAccess();
    __resetBayActivity();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("expires a door record whose ack never came, instead of holding the bay forever", async () => {
    const { io } = fakeIo();
    grantFor("rental-A", "user-A");
    grantFor("rental-B", "user-B");

    await callOpenBay("rental-A", "user-A", io);
    expect(isDoorOpen(KIOSK, BAY)).toBe(true);

    // The Pi never acked — a dropped socket message, a crash mid-command.
    // Well past the real hold (15s) plus the safety margin.
    jest.advanceTimersByTime(120_000);

    expect(isDoorOpen(KIOSK, BAY)).toBe(false);
    const next = await callOpenBay("rental-B", "user-B", io);
    expect(next).not.toHaveBeenCalled();
  });

  it("does NOT expire it early, while the door could still be open", async () => {
    const { io } = fakeIo();
    grantFor("rental-A", "user-A");

    await callOpenBay("rental-A", "user-A", io);
    jest.advanceTimersByTime(5_000); // mid-hold on a 15s bay

    expect(isDoorOpen(KIOSK, BAY)).toBe(true);
  });
});

describe("D-96 — hasLiveGrantOnBay, F2's second dead input", () => {
  beforeEach(() => {
    _clearAllBayAccess();
    __resetBayActivity();
  });

  it("sees another rental's live grant on the bay", () => {
    grantFor("rental-B", "user-B");
    expect(hasLiveGrantOnBay(KIOSK, BAY, "rental-A")).toBe(true);
  });

  it("ignores the releasing rental's OWN grant", () => {
    // Otherwise almost every return-triggered release (R2) would refuse for
    // six minutes, and nothing retries an R2 refusal — the owner would never
    // be told their item was ready.
    grantFor("rental-A", "user-A");
    expect(hasLiveGrantOnBay(KIOSK, BAY, "rental-A")).toBe(false);
  });

  it("ignores grants on other bays and other kiosks", () => {
    grantFor("rental-B", "user-B", "2");
    expect(hasLiveGrantOnBay(KIOSK, "1")).toBe(false);
    expect(hasLiveGrantOnBay("KIOSK-002", "2")).toBe(false);
  });

  it("is false when nobody holds the bay", () => {
    expect(hasLiveGrantOnBay(KIOSK, BAY)).toBe(false);
  });
});

/**
 * The one that would have caught the defect. F2 has always been correct and
 * has never once been able to fire: `decideRelease` could not return
 * `bay_busy` in production because nothing fed it. Here the flag is set by
 * `openBay` — the real writer, through the real controller — and then
 * `requestRelease` is asked, with no flags handed in by hand anywhere.
 */
describe("D-96 — F2 can finally refuse a real release", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    _clearAllBayAccess();
    __resetBayActivity();
  });

  function returnedRental() {
    const locker = {
      id: "locker-id-1",
      lockerNumber: BAY,
      status: "OCCUPIED",
      isOperational: true,
      kioskId: KIOSK,
    };
    return {
      id: "rental-R",
      status: "VERIFICATION", // R2 — a return passed, release to the owner
      ownerId: "owner-1",
      depositedAt: new Date("2026-09-20T10:00:00Z"),
      pickupDate: null,
      releaseRequestedAt: null,
      item: { title: "Digital Multimeter" },
      depositLocker: locker,
      returnLocker: locker,
    } as any;
  }

  it("refuses to stroke a bay whose door a DIFFERENT person just had opened — even onDemand", async () => {
    const { io, emit } = fakeIo();

    // Someone else is at bay 1 right now, door open. Real writer, real path.
    grantFor("rental-OTHER", "user-OTHER");
    await callOpenBay("rental-OTHER", "user-OTHER", io);
    expect(isDoorOpen(KIOSK, BAY)).toBe(true);
    emit.mockClear();

    prismaMock.rental.findUnique.mockResolvedValue(returnedRental());
    prismaMock.kioskConfig.findUnique.mockResolvedValue(null as any);

    const outcome = await requestRelease(io, "rental-R", { onDemand: true });

    expect(outcome.released).toBe(false);
    expect(String(outcome.refusal)).toMatch(/live session or an open door/i);
    // The decisive assertion: no actuator command reached the Pi.
    expect(emit).not.toHaveBeenCalled();
    expect(prismaMock.rental.update).not.toHaveBeenCalled();
  });

  it("goes ahead once that person is genuinely finished with the bay", async () => {
    const { io } = fakeIo();

    grantFor("rental-OTHER", "user-OTHER");
    await callOpenBay("rental-OTHER", "user-OTHER", io);
    // The Pi acks the door shut AND their grant is done with. Both matter:
    // a closed door alone does not mean the person has walked away, which is
    // why the grant is a separate input and lives for six minutes.
    noteDoorClosed(KIOSK, BAY);
    revokeBayAccess("rental-OTHER");

    prismaMock.rental.findUnique.mockResolvedValue(returnedRental());
    prismaMock.kioskConfig.findUnique.mockResolvedValue(null as any);
    prismaMock.locker.findUnique.mockResolvedValue({
      bottomStatus: "AVAILABLE",
      bottomRentalId: null,
    } as any);
    prismaMock.rental.update.mockResolvedValue({} as any);
    prismaMock.notification.create.mockResolvedValue({} as any);

    const outcome = await requestRelease(io, "rental-R", { onDemand: true });
    expect(outcome.released).toBe(true);
  });
});

/**
 * E6.U (user report 2026-09-25: "it went to rental complete, no open locker").
 * The owner's pickup is committed by the real door open, through the real
 * controller — the same rule D-94 made for a claim.
 */
describe("E6.U — openBay commits an owner's pickup on the real door open", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    _clearAllBayAccess();
  });

  it("opens the granted door and runs completeRetrieval with it", async () => {
    const { completeRetrieval } = jest.requireMock("../faceVerificationService");
    (completeRetrieval as jest.Mock).mockClear();
    grantBayAccess({
      rentalId: "owner-pickup",
      userId: "owner-1",
      kioskId: KIOSK,
      action: "retrieve",
      lockerNumber: "2",
      door: "main_door",
    });
    const { io, emit } = fakeIo();

    const next = await callOpenBay("owner-pickup", "owner-1", io);

    expect(next).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      "kiosk:command",
      expect.objectContaining({ action: "open_door", locker_id: 2, door: "main_door" }),
    );
    expect(completeRetrieval).toHaveBeenCalledWith(io, "owner-pickup", "main_door");
  });
});
