import { Response } from "express";

/**
 * POST /admin/rentals/:id/drop-to-lower (2026-10-10): run the SAME guarded drop
 * the :15 sweep runs, for one rental, right now. It adds no rule and bypasses
 * none: a refusal from dropUncollectedToLower is reported, never overridden.
 */

jest.mock("../../config/database", () => ({ __esModule: true, default: {} }));
jest.mock("../../services/retrievalService", () => ({
  dropUncollectedToLower: jest.fn(),
  releaseDisputedItem: jest.fn(),
  releaseForOwnerPickup: jest.fn(),
  requestRelease: jest.fn(),
}));
jest.mock("../../services/auditLogService", () => ({
  recordAudit: jest.fn().mockResolvedValue(undefined),
}));

import { dropRentalToLower } from "../adminController";
import { dropUncollectedToLower } from "../../services/retrievalService";
import { recordAudit } from "../../services/auditLogService";

const dropMock = dropUncollectedToLower as jest.Mock;
const auditMock = recordAudit as jest.Mock;

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}
const io = { to: jest.fn() };
const req = (withIo = true) =>
  ({ params: { id: "rental-1" }, user: { email: "admin@x" }, app: { get: () => (withIo ? io : undefined) } }) as never;

describe("dropRentalToLower", () => {
  beforeEach(() => {
    dropMock.mockReset();
    auditMock.mockClear();
  });

  it("drops through the guarded function, audits it, and says which locker", async () => {
    dropMock.mockResolvedValue({ released: true, lockerNumber: "1" });
    const res = makeRes();
    const next = jest.fn();
    await dropRentalToLower(req(), res, next);
    expect(dropMock).toHaveBeenCalledWith(io, "rental-1");
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "rental.drop_to_lower", targetId: "rental-1" }),
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(next).not.toHaveBeenCalled();
  });

  it("reports a refusal with its reason and does not audit a drop that did not happen", async () => {
    dropMock.mockResolvedValue({ released: false, refusal: "bay 1 has a live session, an open door or a drop running" });
    const next = jest.fn();
    await dropRentalToLower(req(), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/Not dropped: bay 1 has a live session/) }));
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("does nothing without the realtime channel (it could not command the kiosk anyway)", async () => {
    const next = jest.fn();
    await dropRentalToLower(req(false), makeRes(), next);
    expect(dropMock).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/Realtime/) }));
  });
});
