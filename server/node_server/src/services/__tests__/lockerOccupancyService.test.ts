/**
 * D-53 — the server half of kiosk occupancy.
 *
 * These assert the three things that, if wrong, fail *silently* on a wall
 * panel in a corridor: the map's keys, the `isOperational` fold, and the room
 * the payload is addressed to. All three have a single correct answer that
 * can be stated without a running kiosk, which is why they are unit tests;
 * none of them is a substitute for looking at the panel.
 *
 * The room assertion earns its place: `Locker.kioskId` read "kiosk-1" while
 * the real deployed kiosk registers as "KIOSK-001" until 2026-09-03, and
 * Socket.io room membership is an exact string match — so every command went
 * to a room nobody was in while the API reported success.
 */
import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from "../../config/database";
import {
  buildOccupancyMap,
  emitLockerOccupancy,
} from "../lockerOccupancyService";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const KIOSK = "KIOSK-001";

function makeIo() {
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });
  return { io: { to } as never, to, emit };
}

function rows(
  ...specs: Array<[string, string, boolean]>
): Array<Record<string, unknown>> {
  return specs.map(([lockerNumber, status, isOperational]) => ({
    lockerNumber,
    status,
    isOperational,
  }));
}

beforeEach(() => {
  mockReset(prismaMock);
});

describe("buildOccupancyMap", () => {
  it("keys by lockerNumber and passes LockerStatus through verbatim", async () => {
    prismaMock.locker.findMany.mockResolvedValue(
      rows(
        ["1", "AVAILABLE", true],
        ["2", "OCCUPIED", true],
        ["3", "RESERVED", true],
      ) as never,
    );

    // The UI indexes occupancy["1"]..["4"] and compares the value against
    // "AVAILABLE"/"OCCUPIED"/"RESERVED" literally, so both halves matter.
    await expect(buildOccupancyMap(KIOSK)).resolves.toEqual({
      "1": "AVAILABLE",
      "2": "OCCUPIED",
      "3": "RESERVED",
    });
  });

  it("reports a NON-OPERATIONAL bay as OUT_OF_SERVICE even when its status says AVAILABLE", async () => {
    // The regression that matters. status and isOperational are separate
    // columns, and every server-side assignment query requires
    // isOperational: true — so a bay in this state is one the server will
    // never hand out. Reporting it as "Free" is D-53's own lie, reintroduced.
    prismaMock.locker.findMany.mockResolvedValue(
      rows(["1", "AVAILABLE", false], ["2", "AVAILABLE", true]) as never,
    );

    await expect(buildOccupancyMap(KIOSK)).resolves.toEqual({
      "1": "OUT_OF_SERVICE",
      "2": "AVAILABLE",
    });
  });

  it("scopes the query to the kiosk asked about", async () => {
    prismaMock.locker.findMany.mockResolvedValue([] as never);
    await buildOccupancyMap(KIOSK);
    expect(prismaMock.locker.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kioskId: KIOSK } }),
    );
  });
});

describe("emitLockerOccupancy", () => {
  it("addresses kiosk:occupancy to the room built from the kiosk id, exactly", async () => {
    prismaMock.locker.findMany.mockResolvedValue(
      rows(["1", "OCCUPIED", true]) as never,
    );
    const { io, to, emit } = makeIo();

    await emitLockerOccupancy(io, KIOSK);

    expect(to).toHaveBeenCalledWith("kiosk:KIOSK-001");
    expect(emit).toHaveBeenCalledWith(
      "kiosk:occupancy",
      expect.objectContaining({
        kiosk_id: KIOSK,
        lockers: { "1": "OCCUPIED" },
      }),
    );
  });

  it("does NOT emit when the kiosk id matches no Locker row", async () => {
    // The empty-room trap. Emitting an empty map would be worse than not
    // emitting: the Pi relay would overwrite good occupancy with {} and the
    // panel would flip to UNKNOWN with no error anywhere.
    prismaMock.locker.findMany.mockResolvedValue([] as never);
    const { io, emit } = makeIo();

    await emitLockerOccupancy(io, "kiosk-1");

    expect(emit).not.toHaveBeenCalled();
  });

  it("is a no-op without an io server or a kiosk id, rather than throwing", async () => {
    const { emit } = makeIo();
    await expect(emitLockerOccupancy(null, KIOSK)).resolves.toBeUndefined();
    await expect(emitLockerOccupancy(makeIo().io, null)).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });

  it("swallows a database failure — a status push must not abort a committed rental transition", async () => {
    prismaMock.locker.findMany.mockRejectedValue(new Error("db down") as never);
    const { io } = makeIo();

    await expect(emitLockerOccupancy(io, KIOSK)).resolves.toBeUndefined();
  });
});
