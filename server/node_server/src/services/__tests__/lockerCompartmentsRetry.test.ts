import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * D-108 / E6.T — on 2026-09-24 the MySQL connection dropped at 21:03, 22:43
 * and 23:46 (Docker Desktop's port relay; MySQL itself stayed healthy). Both
 * later drops landed inside setCompartment's transaction and cut off what the
 * person was told next. These run the REAL setCompartment and
 * recordCompartmentAfterCommit against a mocked Prisma.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from "../../config/database";
import { recordCompartmentAfterCommit, setCompartment } from "../lockerCompartments";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// The exact errors from the 23:46 log.
const EXPIRED = Object.assign(
  new Error(
    "Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction.",
  ),
  { code: "P2028" },
);
const CLOSED = Object.assign(new Error("Server has closed the connection."), { code: "P1017" });

describe("setCompartment — one retry on a dropped connection (D-108)", () => {
  beforeEach(() => mockReset(prismaMock));

  it("retries once after an expired transaction, and succeeds", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(EXPIRED).mockResolvedValueOnce(undefined as never);
    await expect(setCompartment("locker-2", "top", { status: "AVAILABLE", rentalId: null })).resolves.toBeUndefined();
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it("retries only once — a second drop still surfaces", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(CLOSED).mockRejectedValueOnce(CLOSED);
    await expect(setCompartment("locker-2", "top", { status: "AVAILABLE", rentalId: null })).rejects.toThrow(
      /closed the connection/,
    );
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it("does not retry a real data error", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(new Error("setCompartment: locker x not found"));
    await expect(setCompartment("x", "top", { status: "AVAILABLE", rentalId: null })).rejects.toThrow(/not found/);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("recordCompartmentAfterCommit — the person is told even if the write fails", () => {
  beforeEach(() => mockReset(prismaMock));

  it("returns false and does not throw when the write fails twice", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(CLOSED).mockRejectedValueOnce(CLOSED);
    await expect(
      recordCompartmentAfterCommit("locker-2", "top", { status: "AVAILABLE", rentalId: null }),
    ).resolves.toBe(false);
  });

  it("returns true when the write lands", async () => {
    prismaMock.$transaction.mockResolvedValueOnce(undefined as never);
    await expect(
      recordCompartmentAfterCommit("locker-2", "top", { status: "AVAILABLE", rentalId: null }),
    ).resolves.toBe(true);
  });
});
