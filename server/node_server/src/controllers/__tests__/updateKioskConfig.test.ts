import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

/**
 * D-72, at the level that actually matters.
 *
 * `kioskConfigMerge.test.ts` proves `deepMerge` is correct. It does NOT prove
 * `updateKioskConfig` calls it — a mutation that swapped the merge for a plain
 * replace left that suite fully green. This suite closes that hole by driving
 * the controller itself.
 *
 * What is at stake: the Pi REPLACES `kiosk_config.json` wholesale whenever the
 * pushed payload has a `lockers` key. If a config PUT replaces instead of
 * merges, an admin editing the retrieval policy drops the stored calibration
 * from the payload, the Pi is pushed a config without it... and worse, if the
 * payload carries partial timings, they are written as gospel over values that
 * were hand-calibrated against real hardware.
 */
jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from "../../config/database";
import { updateKioskConfig } from "../adminController";
import { AuthRequest } from "../../middleware/auth";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const REAL_CALIBRATION = {
  "1": { main_door_open_seconds: 15, bottom_door_open_seconds: 15, actuator_extend_seconds: 22, actuator_retract_seconds: 22 },
  "2": { main_door_open_seconds: 5, bottom_door_open_seconds: 5, actuator_extend_seconds: 21, actuator_retract_seconds: 21 },
  "3": { main_door_open_seconds: 15, bottom_door_open_seconds: 15, actuator_extend_seconds: 17, actuator_retract_seconds: 17 },
  "4": { main_door_open_seconds: 15, bottom_door_open_seconds: 15, actuator_extend_seconds: 23, actuator_retract_seconds: 23 },
};

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function makeReq(body: unknown) {
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });
  const req = {
    params: { kioskId: "kiosk-1" },
    body,
    user: { userId: "admin-1", email: "admin@engirent.edu.ph" },
    app: { get: (k: string) => (k === "io" ? { to } : undefined) },
  } as unknown as AuthRequest;
  return { req, to, emit };
}

beforeEach(() => {
  mockReset(prismaMock);
  prismaMock.kioskConfig.findUnique.mockResolvedValue({
    kioskId: "kiosk-1",
    config: { lockers: REAL_CALIBRATION, face_recognition: { capture_attempts: 3 } },
  } as never);
  prismaMock.kioskConfig.upsert.mockImplementation((async (args: {
    create: Record<string, unknown>;
  }) => ({ ...args.create })) as never);
});

describe("D-72 — updateKioskConfig must not drop stored calibration", () => {
  it("keeps the hand-calibrated timings when only the retrieval policy is edited", async () => {
    const { req } = makeReq({ config: { retrieval: { collection_grace_hours: 4 } } });
    await updateKioskConfig(req, makeRes(), jest.fn());

    const written = prismaMock.kioskConfig.upsert.mock.calls[0]![0] as unknown as {
      update: { config: Record<string, unknown> };
    };
    // The exact regression: bay 2's 5s door and every actuator's travel time
    // must still be there after an edit that never mentioned them.
    expect(written.update.config.lockers).toEqual(REAL_CALIBRATION);
    expect(
      (written.update.config.retrieval as Record<string, unknown>).collection_grace_hours,
    ).toBe(4);
  });

  it("pushes the MERGED config to the Pi, not the partial patch", async () => {
    // If the raw patch were pushed, it would have no `lockers` key — harmless
    // today, but the moment a patch carries a partial one the Pi writes it as
    // the whole file.
    const { req, emit } = makeReq({ config: { retrieval: { collection_grace_hours: 4 } } });
    await updateKioskConfig(req, makeRes(), jest.fn());

    expect(emit).toHaveBeenCalledWith("kiosk:config", expect.anything());
    const pushed = emit.mock.calls[0]![1] as Record<string, unknown>;
    expect(pushed.lockers).toEqual(REAL_CALIBRATION);
  });

  it("does not resurrect other bays when one bay is deliberately retimed", async () => {
    const { req } = makeReq({
      config: { lockers: { "3": { main_door_open_seconds: 20 } } },
    });
    await updateKioskConfig(req, makeRes(), jest.fn());

    const written = prismaMock.kioskConfig.upsert.mock.calls[0]![0] as unknown as {
      update: { config: { lockers: Record<string, Record<string, number>> } };
    };
    expect(written.update.config.lockers["3"].main_door_open_seconds).toBe(20);
    expect(written.update.config.lockers["3"].actuator_extend_seconds).toBe(17);
    expect(written.update.config.lockers["2"].main_door_open_seconds).toBe(5);
  });

  it("rejects a missing or non-object config", async () => {
    const next = jest.fn();
    const { req } = makeReq({});
    await updateKioskConfig(req, makeRes(), next);
    expect(next).toHaveBeenCalled();
    expect(prismaMock.kioskConfig.upsert).not.toHaveBeenCalled();
  });
});
