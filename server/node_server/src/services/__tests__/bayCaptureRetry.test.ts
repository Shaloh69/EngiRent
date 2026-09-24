import { mockDeep } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * D-103 — a deposit stuck on "Checking the locker" forever, found on the real
 * bank 2026-09-24 21:52. The owner tapped "Item is placed" 13.4s into bay 1's
 * 15s door hold; the Pi refused the capture (bay busy — D-96, correct), and
 * nothing retried it.
 *
 * Driven through the REAL `itemPlaced` with a REAL grant, and the REAL ack
 * handler function, because a retry helper that nothing calls would be the
 * sixth designed-tested-never-connected defect in this codebase.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock("../faceVerificationService", () => ({
  completeClaim: jest.fn().mockResolvedValue(undefined),
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

import { itemPlaced } from "../../controllers/kioskController";
import { grantBayAccess, _clearAllBayAccess } from "../kioskBayAccessStore";
import {
  handleCaptureAck,
  CAPTURE_RETRY_DELAY_MS,
  CAPTURE_MAX_ATTEMPTS,
  __resetPendingCaptures,
} from "../bayCaptureRetry";

const KIOSK = "KIOSK-001";
const RENTAL = "rental-d103";
const OWNER = "owner-1";

function fakeIo() {
  const emit = jest.fn();
  return { io: { to: jest.fn().mockReturnValue({ emit }) } as any, emit };
}

async function tapItemPlaced(io: any) {
  const res = { json: jest.fn() } as any;
  const next = jest.fn();
  await itemPlaced(
    { user: { userId: OWNER }, body: { rentalId: RENTAL }, app: { get: () => io } } as any,
    res,
    next,
  );
  return { res, next };
}

function captures(emit: jest.Mock) {
  return emit.mock.calls
    .filter(([ev, p]) => ev === "kiosk:command" && p.action === "capture_image")
    .map(([, p]) => p);
}

describe("D-103 — 'Item is placed' during a door hold is retried, not dropped", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    _clearAllBayAccess();
    __resetPendingCaptures();
    grantBayAccess({
      rentalId: RENTAL,
      userId: OWNER,
      kioskId: KIOSK,
      action: "deposit",
      lockerNumber: "1",
      door: "main_door",
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("sends the capture with a command_id, so the Pi's answer can be matched back", async () => {
    const { io, emit } = fakeIo();
    const { next } = await tapItemPlaced(io);

    expect(next).not.toHaveBeenCalled();
    const [cap] = captures(emit);
    expect(cap).toMatchObject({ locker_id: 1, rental_id: RENTAL, num_frames: 3 });
    expect(typeof cap.command_id).toBe("string");
    expect(cap.command_id.length).toBeGreaterThan(0);
  });

  it("re-sends the SAME capture after a bay_busy refusal (the live 21:52 case)", async () => {
    const { io, emit } = fakeIo();
    await tapItemPlaced(io);
    const [first] = captures(emit);

    const handled = handleCaptureAck(io, {
      command_id: first.command_id,
      action: "capture_image",
      status: "refused",
      reason: "bay_busy",
    });
    expect(handled).toBe(true);
    expect(captures(emit)).toHaveLength(1); // not before the delay

    jest.advanceTimersByTime(CAPTURE_RETRY_DELAY_MS);
    const all = captures(emit);
    expect(all).toHaveLength(2);
    expect(all[1]).toEqual(first);
  });

  it("stops once the Pi actually runs it", async () => {
    const { io, emit } = fakeIo();
    await tapItemPlaced(io);
    const [first] = captures(emit);

    handleCaptureAck(io, { command_id: first.command_id, action: "capture_image", status: "ok" });
    // A late duplicate refusal for a settled capture must not resurrect it.
    const handled = handleCaptureAck(io, {
      command_id: first.command_id,
      action: "capture_image",
      status: "refused",
      reason: "bay_busy",
    });
    jest.advanceTimersByTime(CAPTURE_RETRY_DELAY_MS * 5);

    expect(handled).toBe(false);
    expect(captures(emit)).toHaveLength(1);
  });

  it("gives up after the cap instead of retrying forever", async () => {
    const { io, emit } = fakeIo();
    await tapItemPlaced(io);
    const [first] = captures(emit);

    for (let i = 0; i < CAPTURE_MAX_ATTEMPTS + 3; i++) {
      handleCaptureAck(io, {
        command_id: first.command_id,
        action: "capture_image",
        status: "refused",
        reason: "bay_busy",
      });
      jest.advanceTimersByTime(CAPTURE_RETRY_DELAY_MS);
    }

    expect(captures(emit)).toHaveLength(CAPTURE_MAX_ATTEMPTS);
  });

  it("does not retry a refusal that waiting cannot fix, nor an admin one-off capture", async () => {
    const { io, emit } = fakeIo();
    await tapItemPlaced(io);
    const [first] = captures(emit);

    handleCaptureAck(io, {
      command_id: first.command_id,
      action: "capture_image",
      status: "refused",
      reason: "something_else",
    });
    const adminHandled = handleCaptureAck(io, {
      command_id: "ADMIN123",
      action: "capture_image",
      status: "refused",
      reason: "bay_busy",
    });
    jest.advanceTimersByTime(CAPTURE_RETRY_DELAY_MS * 3);

    expect(adminHandled).toBe(false);
    expect(captures(emit)).toHaveLength(1);
  });
});
