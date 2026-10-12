import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * Forgot password (2026-10-12). Runs the REAL service; Prisma and the mailer
 * are mocked. Pins: no account enumeration, no stored or mailed-twice codes,
 * five tries, single use, and a reset that signs other devices out.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock("../../utils/email", () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));
jest.mock("../../config/env", () => ({
  __esModule: true,
  default: {
    JWT_SECRET: "x".repeat(40),
    SMTP_HOST: "smtp.example.com",
    SMTP_USER: "sender@example.com",
    SMTP_PASSWORD: "app-password",
  },
}));

import prisma from "../../config/database";
import env from "../../config/env";
import { sendEmail } from "../../utils/email";
import {
  codeMatches,
  generateCode,
  hashCode,
  MAX_ATTEMPTS,
  requestPasswordReset,
  resetPasswordWithCode,
} from "../passwordResetService";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const sendMock = sendEmail as jest.Mock;
const user = { id: "u1", email: "student@students.uclm.edu.ph", firstName: "Ana", isActive: true };

beforeEach(() => {
  mockReset(prismaMock);
  sendMock.mockClear();
  prismaMock.$transaction.mockResolvedValue([] as never);
  (env as { SMTP_PASSWORD?: string }).SMTP_PASSWORD = "app-password";
});

describe("codes", () => {
  it("are 6 digits, and only the bound HMAC matches", () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/);
    const h = hashCode("u1", "042517");
    expect(h).not.toContain("042517");
    expect(codeMatches("u1", "042517", h)).toBe(true);
    expect(codeMatches("u1", "042518", h)).toBe(false);
    expect(codeMatches("u2", "042517", h)).toBe(false); // bound to the account
  });
});

describe("requestPasswordReset", () => {
  it("emails a code for a real account and stores only its hash", async () => {
    prismaMock.user.findUnique.mockResolvedValue(user as never);
    prismaMock.passwordResetCode.findMany.mockResolvedValue([] as never);

    await requestPasswordReset("Student@students.uclm.edu.ph ");

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "student@students.uclm.edu.ph" } }),
    );
    const created = prismaMock.passwordResetCode.create.mock.calls[0][0].data as { codeHash: string };
    const mail = sendMock.mock.calls[0][0] as { to: string; text: string };
    const code = mail.text.match(/\d{6}/)![0];
    expect(mail.to).toBe(user.email);
    expect(JSON.stringify(sendMock.mock.calls[0][0].subject)).not.toContain(code); // subjects are logged
    expect(created.codeHash).not.toContain(code);
    expect(codeMatches("u1", code, created.codeHash)).toBe(true);
  });

  it("says nothing different for an unknown or deactivated email, and sends nothing", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null as never);
    await expect(requestPasswordReset("nobody@x.com")).resolves.toBeUndefined();
    prismaMock.user.findUnique.mockResolvedValueOnce({ ...user, isActive: false } as never);
    await expect(requestPasswordReset(user.email)).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("does not send a second code within the resend gap or past the hourly limit", async () => {
    prismaMock.user.findUnique.mockResolvedValue(user as never);
    prismaMock.passwordResetCode.findMany.mockResolvedValueOnce([{ createdAt: new Date(Date.now() - 10_000) }] as never);
    await requestPasswordReset(user.email);
    const five = Array.from({ length: 5 }, (_, i) => ({ createdAt: new Date(Date.now() - (i + 2) * 600_000) }));
    prismaMock.passwordResetCode.findMany.mockResolvedValueOnce(five as never);
    await requestPasswordReset(user.email);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("refuses everyone alike when the server has no email", async () => {
    (env as { SMTP_PASSWORD?: string }).SMTP_PASSWORD = undefined;
    await expect(requestPasswordReset("anyone@x.com")).rejects.toMatchObject({ statusCode: 503 });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("resetPasswordWithCode", () => {
  const row = (attempts = 0) => ({ id: "c1", userId: "u1", codeHash: hashCode("u1", "123456"), attempts });

  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(user as never);
    prismaMock.passwordResetCode.updateMany.mockResolvedValue({ count: 1 } as never);
  });

  it("a wrong code counts down the tries and changes nothing", async () => {
    prismaMock.passwordResetCode.findFirst.mockResolvedValue(row(0) as never);
    await expect(resetPasswordWithCode(user.email, "000000", "NewPass@2026")).rejects.toThrow("4 tries left");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("the last wrong try kills the code", async () => {
    prismaMock.passwordResetCode.findFirst.mockResolvedValue(row(MAX_ATTEMPTS - 1) as never);
    await expect(resetPasswordWithCode(user.email, "000000", "NewPass@2026")).rejects.toThrow("no longer works");
    expect(prismaMock.passwordResetCode.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1" }, data: expect.objectContaining({ usedAt: expect.any(Date) }) }),
    );
  });

  it("an exhausted or raced code is refused even with the right digits", async () => {
    prismaMock.passwordResetCode.findFirst.mockResolvedValue(row(MAX_ATTEMPTS) as never);
    prismaMock.passwordResetCode.updateMany.mockResolvedValueOnce({ count: 0 } as never);
    await expect(resetPasswordWithCode(user.email, "123456", "NewPass@2026")).rejects.toThrow("expired");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("the right code sets a hashed password, signs other devices out, and tells the student", async () => {
    prismaMock.passwordResetCode.findFirst.mockResolvedValue(row(0) as never);
    await resetPasswordWithCode(user.email, " 123456 ", "NewPass@2026");
    const data = prismaMock.user.update.mock.calls[0][0].data as { password: string; refreshToken: null };
    expect(data.password).not.toBe("NewPass@2026");
    expect(data.password).toMatch(/^\$2[aby]\$/);
    expect(data.refreshToken).toBeNull();
    expect(sendMock.mock.calls[0][0].subject).toMatch(/password was changed/);
  });

  it("no live code at all: a plain 'ask for a new one'", async () => {
    prismaMock.passwordResetCode.findFirst.mockResolvedValue(null as never);
    await expect(resetPasswordWithCode(user.email, "123456", "NewPass@2026")).rejects.toThrow("Ask for a new one");
  });
});
