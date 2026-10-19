import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * Concerns v2 flows (user rulings 2026-10-13). Runs the REAL service; Prisma,
 * storage, email and the settlement release are mocked. Pins: no case without
 * the required evidence, the other student is told, a defect decision gives rent
 * back and pauses the listing, a damage decision takes the deposit first and
 * leaves the rest owed (and the account limited until paid).
 */

jest.mock("../../config/database", () => ({ __esModule: true, default: mockDeep<PrismaClient>() }));
jest.mock("../../config/env", () => ({
  __esModule: true,
  default: { PAYMENT_MANUAL_CHANNEL: "GCash", PAYMENT_MANUAL_CONFIRM_WINDOW: "within 24 hours", API_PUBLIC_URL: "https://api.test" },
}));
jest.mock("../storageService", () => ({ saveBuffer: jest.fn(), signedMediaUrl: (p: string) => `https://api.test/media/secure/${p}` }));
jest.mock("../../utils/email", () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));
jest.mock("../adminRoom", () => ({ notifyAdmins: jest.fn() }));
jest.mock("../rentalSettlementService", () => ({ releaseHeldDeposit: jest.fn().mockResolvedValue(true) }));
jest.mock("../../controllers/paymentController", () => ({ createRefund: jest.fn() }));

import prisma from "../../config/database";
import { saveBuffer } from "../storageService";
import { releaseHeldDeposit } from "../rentalSettlementService";
import {
  createConcern,
  decideConcern,
  owedConcernFor,
  respondToConcern,
  runConcernSweep,
  sniffEvidence,
  submitOwedPayment,
  confirmOwedPayment,
  concernForParty,
} from "../concernService";

const db = prisma as unknown as DeepMockProxy<PrismaClient>;
const H = 3_600_000;
const now = new Date("2026-10-13T06:00:00Z");

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(8)]);
const photo = { buffer: JPEG, mimetype: "image/jpeg", size: JPEG.length };
const video = { buffer: MP4, mimetype: "video/mp4", size: MP4.length };

const renter = { id: "renter-1", email: "renter@x", firstName: "Rina" };
const owner = { id: "owner-1", email: "owner@x", firstName: "Omar" };
const item = { id: "item-1", title: "Calculator", replacementValue: 1000, pricePerDay: 30 };

function rentalRow(over: object = {}) {
  return {
    id: "rental-1",
    renterId: renter.id,
    ownerId: owner.id,
    itemId: item.id,
    status: "ACTIVE",
    verificationStatus: null,
    verificationId: null,
    claimedAt: new Date(now.getTime() - 2 * H),
    startDate: new Date(now.getTime() - 3 * H),
    endDate: new Date(now.getTime() + 69 * H),
    depositHoldUntil: null,
    securityDeposit: 300,
    item,
    renter,
    owner,
    ...over,
  };
}

beforeEach(() => {
  mockReset(db);
  (saveBuffer as jest.Mock).mockClear();
  (releaseHeldDeposit as jest.Mock).mockClear();
  db.user.findMany.mockResolvedValue([{ id: "admin-1" }] as never);
  db.concern.count.mockResolvedValue(0 as never);
  db.transaction.count.mockResolvedValue(0 as never);
});

describe("evidence bytes", () => {
  it("knows a photo and a video by their bytes, not their label", () => {
    expect(sniffEvidence(JPEG)).toBe("jpg");
    expect(sniffEvidence(MP4)).toBe("mp4");
    expect(sniffEvidence(Buffer.from("not an image at all"))).toBeNull();
  });
});

describe("reporting a defect (renter)", () => {
  beforeEach(() => {
    db.rental.findUnique.mockResolvedValue(rentalRow() as never);
    db.concern.findMany.mockResolvedValue([] as never);
    db.concern.create.mockResolvedValue({ id: "c1", referenceNo: "ER-CON-2026-0001", rentalId: "rental-1" } as never);
    db.concern.delete.mockResolvedValue({} as never);
  });

  it("refuses a report with no video, and creates nothing", async () => {
    await expect(
      createConcern(undefined, { userId: renter.id, rentalId: "rental-1", kind: "DEFECT_ON_RECEIPT", statement: "x".repeat(60), photos: [photo], videos: [] }, now),
    ).rejects.toThrow(/video/);
    expect(db.concern.create).not.toHaveBeenCalled();
  });

  it("creates the case with its evidence, gives the owner 24 h to answer, and tells both", async () => {
    await createConcern(
      undefined,
      { userId: renter.id, rentalId: "rental-1", kind: "DEFECT_ON_RECEIPT", statement: "The screen stays black when I press ON, even with new batteries.", photos: [photo, photo], videos: [video] },
      now,
    );
    const created = db.concern.create.mock.calls[0][0].data as { respondentId: string; responseDueAt: Date; reporterParty: string };
    expect(created.respondentId).toBe(owner.id);
    expect(created.reporterParty).toBe("RENTER");
    expect(created.responseDueAt.getTime()).toBe(now.getTime() + 24 * H);
    expect(saveBuffer).toHaveBeenCalledTimes(3);
    const evidence = db.concernEvidence.createMany.mock.calls[0][0]!.data as Array<{ type: string }>;
    expect(evidence.map((e) => e.type).sort()).toEqual(["PHOTO", "PHOTO", "STATEMENT", "VIDEO"]);
    const toOwner = db.notification.create.mock.calls.map((c) => c[0].data).find((d) => d.userId === owner.id)!;
    expect(toOwner.message).toMatch(/give your side/);
  });

  it("the owner cannot report a defect", async () => {
    await expect(
      createConcern(undefined, { userId: owner.id, rentalId: "rental-1", kind: "DEFECT_ON_RECEIPT", statement: "x".repeat(60), photos: [photo], videos: [video] }, now),
    ).rejects.toThrow(/Only the renter/);
  });

  it("a fake 'video' is rejected and the half-made case is removed", async () => {
    const fake = { buffer: Buffer.from("plain text pretending"), mimetype: "video/mp4", size: 21 };
    await expect(
      createConcern(undefined, { userId: renter.id, rentalId: "rental-1", kind: "DEFECT_ON_RECEIPT", statement: "x".repeat(60), photos: [photo], videos: [fake] }, now),
    ).rejects.toThrow(/MP4/);
    expect(db.concern.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });
});

function concernRow(over: object = {}) {
  return {
    id: "c1",
    referenceNo: "ER-CON-2026-0001",
    rentalId: "rental-1",
    kind: "DEFECT_ON_RECEIPT",
    status: "AWAITING_RESPONSE",
    reporterId: renter.id,
    reporterParty: "RENTER",
    respondentId: owner.id,
    responseDueAt: new Date(now.getTime() + 24 * H),
    respondedAt: null,
    createdAt: new Date(now.getTime() - 1 * H),
    reporter: renter,
    respondent: owner,
    rental: rentalRow(),
    amountOwed: null,
    owedPaidAt: null,
    ...over,
  };
}

describe("answering and the 24 h sweep", () => {
  it("only the other student answers, once; the case then goes to an admin", async () => {
    db.concern.findUnique.mockResolvedValue(concernRow() as never);
    await expect(
      respondToConcern(undefined, { userId: renter.id, concernId: "c1", statement: "x".repeat(30), photos: [], videos: [] }, now),
    ).rejects.toThrow(/Only the other student/);
    await respondToConcern(undefined, { userId: owner.id, concernId: "c1", statement: "It worked when I deposited it.", photos: [], videos: [] }, now);
    expect(db.concern.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { respondedAt: now, status: "UNDER_REVIEW" } });
  });

  it("no answer in 24 h: the case goes to an admin anyway and both are told", async () => {
    db.concern.findMany.mockResolvedValue([concernRow()] as never);
    await expect(runConcernSweep(undefined, now)).resolves.toBe(1);
    expect(db.concern.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { status: "UNDER_REVIEW" } });
    expect(db.notification.create).toHaveBeenCalledTimes(2);
  });
});

describe("deciding", () => {
  it("a defect reported within 3 h of pickup: the base is the WHOLE rent (ruling 3)", async () => {
    db.concern.findUnique.mockResolvedValue(concernRow({ status: "UNDER_REVIEW" }) as never);
    db.transaction.findMany.mockResolvedValue([{ type: "RENTAL_PAYMENT", amount: 216, status: "COMPLETED" }] as never);
    db.transaction.findFirst.mockResolvedValue({ id: "t-pay", paymongoPaymentId: null } as never);
    await decideConcern(undefined, "c1", "admin-1", { pct: 50, note: "Reported an hour after pickup; the owner's own photos show the crack." }, now);
    const refund = db.transaction.create.mock.calls.map((c) => c[0].data).find((d) => d.type === "RENTAL_REFUND")!;
    expect(refund.amount).toBe(108);
  });

  it("a defect at 50%: rent back from the unused days, return within 24 h, listing paused, both told", async () => {
    // Picked up 10 h ago (past the 3 h full-rent rule), reported 1 h ago; 72 h rental.
    db.concern.findUnique.mockResolvedValue(
      concernRow({
        status: "UNDER_REVIEW",
        rental: rentalRow({
          claimedAt: new Date(now.getTime() - 10 * H),
          startDate: new Date(now.getTime() - 11 * H),
          endDate: new Date(now.getTime() + 61 * H),
        }),
      }) as never,
    );
    db.transaction.findMany.mockResolvedValue([
      { type: "RENTAL_PAYMENT", amount: 216, status: "COMPLETED" },
      { type: "SECURITY_DEPOSIT", amount: 300, status: "COMPLETED" },
    ] as never);
    db.transaction.findFirst.mockResolvedValue({ id: "t-pay", paymongoPaymentId: null } as never);
    await decideConcern(undefined, "c1", "admin-1", { pct: 50, note: "The photos show a cracked display under the cover." }, now);

    const refund = db.transaction.create.mock.calls.map((c) => c[0].data).find((d) => d.type === "RENTAL_REFUND")!;
    // reported 1 h before now: 62 of 72 h unused -> 216 * 62/72 = 186, owner 50% -> 93
    expect(refund.amount).toBe(93);
    expect(db.rental.update).toHaveBeenCalledWith({ where: { id: "rental-1" }, data: { endDate: new Date(now.getTime() + 24 * H) } });
    expect(db.item.update.mock.calls[0][0].data).toMatchObject({ isListed: false, isFlagged: true });
    const decided = db.concern.update.mock.calls.map((c) => c[0].data).find((d) => (d as { status?: string }).status)!;
    expect(decided).toMatchObject({ status: "PARTLY_UPHELD", responsibilityPct: 50, refundAmount: 93 });
    expect(db.notification.create).toHaveBeenCalledTimes(2);
  });

  it("damage 100% of ₱800 with ₱300 held: ₱300 from the deposit to the owner, ₱500 owed", async () => {
    db.concern.findUnique.mockResolvedValue(
      concernRow({
        kind: "DAMAGE_ON_RETURN",
        status: "UNDER_REVIEW",
        reporterId: owner.id,
        reporterParty: "OWNER",
        respondentId: renter.id,
        reporter: owner,
        respondent: renter,
        rental: rentalRow({ status: "COMPLETED", verificationStatus: "APPROVED", depositHoldUntil: new Date(now.getTime() + 10 * H) }),
      }) as never,
    );
    db.transaction.findMany.mockResolvedValue([{ type: "SECURITY_DEPOSIT", amount: 300, status: "COMPLETED" }] as never);
    await decideConcern(undefined, "c1", "admin-1", { pct: 100, assessedAmount: 800, note: "The video shows the hinge snapped; the owner's photos before the rental show it whole." }, now);

    const created = db.transaction.create.mock.calls.map((c) => c[0].data);
    expect(created.find((d) => d.type === "DAMAGE_FEE")!.amount).toBe(300);
    expect(created.find((d) => d.type === "OWNER_PAYOUT")!.amount).toBe(300);
    expect(releaseHeldDeposit).toHaveBeenCalledWith("rental-1", expect.stringMatching(/damage case/));
    const decided = db.concern.update.mock.calls.map((c) => c[0].data).find((d) => (d as { status?: string }).status)!;
    expect(decided).toMatchObject({ status: "UPHELD", chargeAmount: 800, fromDeposit: 300, amountOwed: 500 });
  });

  it("refuses a decision without a real explanation", async () => {
    db.concern.findUnique.mockResolvedValue(concernRow({ status: "UNDER_REVIEW" }) as never);
    await expect(decideConcern(undefined, "c1", "admin-1", { pct: 50, note: "ok" }, now)).rejects.toThrow(/at least 20 characters/);
  });
});

describe("paying what is owed", () => {
  const owed = concernRow({ kind: "DAMAGE_ON_RETURN", status: "UPHELD", respondentId: renter.id, respondent: renter, reporter: owner, amountOwed: 500 });

  it("the renter's payment waits for staff; once confirmed the owner is paid and the limit lifts", async () => {
    db.concern.findUnique.mockResolvedValue(owed as never);
    db.transaction.findFirst.mockResolvedValueOnce(null as never);
    await submitOwedPayment(undefined, "c1", renter.id, "GC-123456");
    expect(db.transaction.create.mock.calls[0][0].data).toMatchObject({ type: "DAMAGE_PAYMENT", status: "PENDING", amount: 500, paymentReferenceNo: "GC-123456" });

    db.transaction.findFirst.mockResolvedValueOnce({ id: "t-pay", amount: 500 } as never);
    await confirmOwedPayment(undefined, "c1", "admin-1", now);
    expect(db.transaction.update).toHaveBeenCalledWith({ where: { id: "t-pay" }, data: { status: "COMPLETED", paidAt: now } });
    const payout = db.transaction.create.mock.calls.map((c) => c[0].data).find((d) => d.type === "OWNER_PAYOUT")!;
    expect(payout).toMatchObject({ userId: owner.id, amount: 500 });
    expect(db.concern.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { owedPaidAt: now } });
  });

  it("only the renter who owes can pay", async () => {
    db.concern.findUnique.mockResolvedValue(owed as never);
    await expect(submitOwedPayment(undefined, "c1", owner.id, "GC-123456")).rejects.toThrow(/Access denied/);
  });

  it("an unpaid amount is what the account limit looks for", async () => {
    db.concern.findFirst.mockResolvedValue({ id: "c1", referenceNo: "ER-CON-2026-0001", amountOwed: 500, rentalId: "rental-1" } as never);
    await expect(owedConcernFor(renter.id)).resolves.toMatchObject({ amountOwed: 500 });
    expect(db.concern.findFirst.mock.calls[0][0]!.where).toMatchObject({ respondentId: renter.id, owedPaidAt: null });
  });

  // 2026-10-15, ER-CON-2026-0002: the renter paid, staff confirmed, and the case
  // still read as a red "upheld" with nothing saying it was finished.
  describe("what the case says after the decision", () => {
    const paidAt = new Date("2026-10-15T15:18:43Z");
    const view = (over: object) => {
      db.concern.findUnique.mockResolvedValue({
        ...owed,
        reporterId: owner.id,
        reporterParty: "OWNER",
        rental: { ...rentalRow(), item: { title: "Calculator" } },
        evidence: [],
        events: [],
        decidedAt: now,
        ...over,
      } as never);
      db.transaction.findFirst.mockResolvedValue(null as never);
    };

    it("paid and confirmed: settled for both students, no payment asked, the ruling explained", async () => {
      view({ amountOwed: 200, owedPaidAt: paidAt });
      const r = await concernForParty("c1", renter.id);
      expect(r.status).toBe("UPHELD");
      expect(r.settled).toBe(true);
      expect(r.payment).toBeNull();
      expect(r.nextStep).toMatch(/^Settled\. Your ₱200\.00 payment was confirmed/);
      expect(r.nextStep).toMatch(/limit on your account is lifted/);
      expect(r.nextStep).toMatch(/stays on record as upheld/);
      const o = await concernForParty("c1", owner.id);
      expect(o.settled).toBe(true);
      expect(o.nextStep).toMatch(/^Settled\. The renter paid the ₱200\.00/);
    });

    it("still owed: not settled, and the renter is asked to pay", async () => {
      view({ amountOwed: 200, owedPaidAt: null });
      const r = await concernForParty("c1", renter.id);
      expect(r.settled).toBe(false);
      expect(r.payment).not.toBeNull();
      expect(r.nextStep).toMatch(/^Pay the ₱200\.00 you owe/);
    });

    it("payment sent, not yet confirmed: not settled, told staff are confirming", async () => {
      view({ amountOwed: 200, owedPaidAt: null });
      db.transaction.findFirst.mockResolvedValue({ id: "t-pay", amount: 200 } as never);
      const r = await concernForParty("c1", renter.id);
      expect(r.settled).toBe(false);
      expect(r.nextStep).toMatch(/Your payment was sent/);
    });

    it("covered by the deposit: settled from the start", async () => {
      view({ amountOwed: 0, owedPaidAt: null });
      const r = await concernForParty("c1", renter.id);
      expect(r.settled).toBe(true);
      expect(r.nextStep).toMatch(/covered by the deposit/);
    });
  });
});
