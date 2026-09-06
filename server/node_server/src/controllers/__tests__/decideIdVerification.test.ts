import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

// E2.4 / D-1's last open bullet.
//
// `decideIdVerification` wrote a Notification row and emitted nothing. That is
// the same shape as the payment bug the PAYMENTS RULING fixed: an admin action
// that reaches the database and stops there. The consequence is specific — the
// Profile tab's Identity tile is driven by `verificationStatus`, so until the
// user manually refetches, an approved student is still told "Under review"
// and a rejected one is never told why.

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock("axios");

import prisma from "../../config/database";
import { decideIdVerification } from "../adminController";
import { AuthRequest } from "../../middleware/auth";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function makeIo() {
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });
  return { io: { to }, to, emit };
}

function makeReq(
  decision: "APPROVE" | "REJECT",
  io: unknown,
  reason?: string,
): AuthRequest {
  return {
    params: { id: "student-1" },
    body: { decision, ...(reason ? { reason } : {}) },
    user: {
      userId: "admin-1",
      email: "admin@engirent.edu.ph",
      studentId: "a1",
      role: "ADMIN",
    },
    app: { get: (k: string) => (k === "io" ? io : undefined) },
  } as unknown as AuthRequest;
}

function mockDecision(approved: boolean, reason: string | null = null) {
  prismaMock.user.findUnique.mockResolvedValue({
    id: "student-1",
    email: "s1@students.uclm.edu.ph",
  } as never);

  const updated = {
    id: "student-1",
    isVerified: approved,
    verificationStatus: approved ? "APPROVED" : "REJECTED",
    verificationReason: reason,
    verificationNote: null,
    verifiedAt: new Date("2026-09-07T00:00:00Z"),
  };

  // $transaction receives a callback; run it against a tx stub and return
  // what the real one returns, so the emit sees a realistic payload.
  (prismaMock.$transaction as unknown as jest.Mock).mockImplementation(
    async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        user: { update: jest.fn().mockResolvedValue(updated) },
        notification: { create: jest.fn().mockResolvedValue({}) },
      }),
  );
  return updated;
}

beforeEach(() => {
  mockReset(prismaMock);
  jest.clearAllMocks();
});

describe("decideIdVerification emits a decision to the student", () => {
  it("emits verification:approved to the student's own room on APPROVE", async () => {
    mockDecision(true);
    const { io, to, emit } = makeIo();
    await decideIdVerification(makeReq("APPROVE", io), makeRes(), jest.fn());

    expect(to).toHaveBeenCalledWith("user:student-1");
    expect(emit).toHaveBeenCalledWith(
      "verification:approved",
      expect.objectContaining({
        userId: "student-1",
        isVerified: true,
        verificationStatus: "APPROVED",
      }),
    );
  });

  it("emits verification:rejected with the reason the student must act on", async () => {
    mockDecision(false, "UNREADABLE");
    const { io, to, emit } = makeIo();
    await decideIdVerification(
      makeReq("REJECT", io, "UNREADABLE"),
      makeRes(),
      jest.fn(),
    );

    expect(to).toHaveBeenCalledWith("user:student-1");
    expect(emit).toHaveBeenCalledWith(
      "verification:rejected",
      expect.objectContaining({
        userId: "student-1",
        isVerified: false,
        verificationStatus: "REJECTED",
        verificationReason: "UNREADABLE",
      }),
    );
  });

  it("does not emit an approval when the decision was a rejection", async () => {
    mockDecision(false, "UNREADABLE");
    const { io, emit } = makeIo();
    await decideIdVerification(
      makeReq("REJECT", io, "UNREADABLE"),
      makeRes(),
      jest.fn(),
    );
    const events = emit.mock.calls.map((c) => c[0]);
    expect(events).not.toContain("verification:approved");
  });

  // The socket is optional infrastructure; a missing io must not turn an
  // otherwise-successful admin decision into a 500. Same guard the admin-room
  // helper has.
  it("still completes the decision when io is unavailable", async () => {
    mockDecision(true);
    const res = makeRes();
    const next = jest.fn();
    await decideIdVerification(makeReq("APPROVE", undefined), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });
});
