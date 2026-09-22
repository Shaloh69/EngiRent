import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

/**
 * D-92 — the duplicate-registration check used one message
 * ("Email or Student ID already registered") for two different collisions,
 * so a student whose STUDENT ID collided with someone else's account (e.g. a
 * typo) had no way to tell that from an email collision, or to tell either
 * apart from having registered before. Found while investigating a user
 * report of registration "failing for some reason" — no data corruption was
 * found, but this message was a real, separate defect.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from "../../config/database";
import { register } from "../authController";
import { AuthRequest } from "../../middleware/auth";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function registerReq(overrides: Record<string, unknown> = {}): AuthRequest {
  return {
    body: {
      email: "new@students.uclm.edu.ph",
      password: "password123",
      studentId: "20200001",
      firstName: "New",
      lastName: "Student",
      phoneNumber: "09171234567",
      ...overrides,
    },
  } as unknown as AuthRequest;
}

describe("register — duplicate message names which field collided", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("says it's the email when only the email matches", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      email: "new@students.uclm.edu.ph",
      studentId: "someone-elses-id",
    } as never);
    const next = jest.fn();
    await register(registerReq(), makeRes(), next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/email is already registered/i) }),
    );
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("says it's the Student ID when only the Student ID matches", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      email: "someone-else@students.uclm.edu.ph",
      studentId: "20200001",
    } as never);
    const next = jest.fn();
    await register(registerReq(), makeRes(), next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/Student ID is already registered/i) }),
    );
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("says both when both match the same existing row", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      email: "new@students.uclm.edu.ph",
      studentId: "20200001",
    } as never);
    const next = jest.fn();
    await register(registerReq(), makeRes(), next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/email and Student ID are already registered/i) }),
    );
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("proceeds to create the account when neither collides", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: "u1",
      email: "new@students.uclm.edu.ph",
      studentId: "20200001",
      role: "STUDENT",
    } as never);
    prismaMock.user.update.mockResolvedValue({} as never);
    const next = jest.fn();
    await register(registerReq(), makeRes(), next);
    expect(next).not.toHaveBeenCalled();
    expect(prismaMock.user.create).toHaveBeenCalled();
  });
});
