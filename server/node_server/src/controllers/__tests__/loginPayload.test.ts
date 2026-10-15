/**
 * The login reply is a hand-written field list (not PROFILE_SELECT), and twice
 * now a field the app depends on was left out of it: the verification fields
 * (D-1) and, on 2026-10-15, the face-enrolment fields, which made the app tell
 * students who had ALREADY updated their face to update it after every login.
 *
 * This pins the fields the app's home screen and kiosk flow read.
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

it("the login reply carries the face-enrolment state the app shows the banner from", async () => {
  const pending = new Date("2026-10-15T13:00:00Z");
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
    faceEnrolmentVersion: 2,
    pendingFaceAt: pending,
    payoutAccountNumber: null,
  } as never);
  prismaMock.user.update.mockResolvedValue({} as never);
  const r = res();
  const next = jest.fn();

  await login({ body: { email: "s@x", password: "pw" } } as unknown as AuthRequest, r, next);

  expect(next).not.toHaveBeenCalled();
  const user = r.json.mock.calls[0][0].data.user;
  expect(user.faceEnrolmentVersion).toBe(2);
  expect(user.pendingFaceAt).toBe(pending);
  // and the earlier D-1 fields are still there
  expect(user).toHaveProperty("verificationStatus");
  expect(user).toHaveProperty("profileComplete");
});
