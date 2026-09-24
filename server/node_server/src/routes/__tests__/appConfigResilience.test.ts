import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient, Prisma } from "@prisma/client";
import express from "express";
import request from "supertest";

// D-102, 2026-09-24. At ~21:03 the live database stopped answering for a few
// seconds, `GET /api/v1/app-config` awaited Prisma with no try/catch, and the
// rejected promise killed the whole API. Every app launch calls this route,
// so the outage lasted until a human restarted the server by hand.
//
// These go through the REAL router and the REAL error handler, not the
// handler in isolation. The bug was the wiring, so the wiring is what must
// be tested.

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock("axios");

import prisma from "../../config/database";
import apiRouter from "../index";
import { errorHandler } from "../../middleware/errorHandler";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", apiRouter);
  app.use(errorHandler);
  return app;
}

// The exact error the live log recorded.
function dbUnreachable() {
  return new Prisma.PrismaClientKnownRequestError(
    "Can't reach database server at `127.0.0.1:3307`",
    { code: "P1001", clientVersion: "5.22.0" },
  );
}

describe("D-102 — /app-config survives a database blip", () => {
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    mockReset(prismaMock);
    unhandled = [];
    process.on("unhandledRejection", onUnhandled);
  });

  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
  });

  it("answers with an error response instead of an unhandled rejection when the DB is unreachable", async () => {
    prismaMock.appRelease.findUnique.mockRejectedValue(dbUnreachable());

    const res = await request(makeApp()).get("/api/v1/app-config");

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.success).toBe(false);
    // Give any stray rejection a tick to surface before asserting none did.
    await new Promise((r) => setImmediate(r));
    expect(unhandled).toEqual([]);
  });

  it("also covers the second query failing after the first succeeded", async () => {
    prismaMock.appRelease.findUnique.mockResolvedValue(null);
    prismaMock.feedback.findMany.mockRejectedValue(dbUnreachable());

    const res = await request(makeApp()).get("/api/v1/app-config");

    expect(res.status).toBeGreaterThanOrEqual(500);
    await new Promise((r) => setImmediate(r));
    expect(unhandled).toEqual([]);
  });

  it("keeps serving normally once the DB is back", async () => {
    const app = makeApp();
    prismaMock.appRelease.findUnique.mockRejectedValueOnce(dbUnreachable());
    await request(app).get("/api/v1/app-config");

    prismaMock.appRelease.findUnique.mockResolvedValue(null);
    prismaMock.feedback.findMany.mockResolvedValue([]);
    const res = await request(app).get("/api/v1/app-config");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.creditedFixes).toEqual([]);
  });
});
