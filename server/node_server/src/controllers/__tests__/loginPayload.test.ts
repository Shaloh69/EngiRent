/**
 * The login reply is a hand-written field list (not PROFILE_SELECT), and twice
 * a field the app depends on was left out of it: the verification fields (D-1)
 * and, on the face-liveness branch (2026-10-15), the face-enrolment fields. The
 * app now also loads the full profile right after login, but this pins the
 * fields the app reads from the login reply itself.
 */
import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

jest.mock("../../config/database", () => ({ __esModule: true, default: mockDeep<PrismaClient>() }));
jest.mock("../../utils/bcrypt", () => ({ comparePassword: jest.fn().mockResolvedValue(true), hashPassword: jest.fn() }));
jest.mock("../../utils/jwt", () => ({
  generateAccessToken: () => "access",
  generateRefreshToken: () => "refresh",
  verifyRefreshToken: jest.fn(),
}));

import prisma from "../../config/database";
import { login } from "../authController";
import { AuthRequest } from "../../middleware/auth";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function res() {
  const r: Partial<Response> = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json = jest.fn().mockReturnValue(r);
  return r as Response & { json: jest.Mock };
}

beforeEach(() => mockReset(prismaMock));

it("the login reply carries the verification state the app reads (D-1)", async () => {
  prismaMock.user.findUnique.mockResolvedValue({
    id: "u1",
    email: "s@x",
    password: "hash",
    studentId: "1",
    firstName: "A",
    lastName: "B",
    phoneNumber: "0",
    isActive: true,
    role: "STUDENT",
    verificationStatus: "APPROVED",
    verificationReason: null,
    verificationNote: null,
    profileComplete: true,
    payoutAccountNumber: null,
  } as never);
  prismaMock.user.update.mockResolvedValue({} as never);
  const r = res();
  const next = jest.fn();

  await login({ body: { email: "s@x", password: "pw" } } as unknown as AuthRequest, r, next);

  expect(next).not.toHaveBeenCalled();
  const user = r.json.mock.calls[0][0].data.user;
  expect(user.verificationStatus).toBe("APPROVED");
  expect(user).toHaveProperty("verificationReason");
  expect(user).toHaveProperty("verificationNote");
  expect(user.profileComplete).toBe(true);
});
