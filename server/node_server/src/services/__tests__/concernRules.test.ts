import {
  damageCap,
  damageOutcome,
  decisionStatus,
  defectRefund,
  evidenceProblems,
  evidenceRequirement,
  explainDecision,
  reportWindows,
  WindowFacts,
} from "../concernRules";

/** Concerns v2 rules (user rulings 2026-10-13). These pin the windows and every peso. */

const H = 3_600_000;
const t0 = new Date("2026-10-13T00:00:00Z");
const at = (h: number) => new Date(t0.getTime() + h * H);

describe("evidence", () => {
  it("reporters of the two damage kinds need text, 1-5 photos AND a video (ruling 5)", () => {
    const r = evidenceRequirement("DEFECT_ON_RECEIPT", "REPORTER");
    expect(r).toMatchObject({ minStatementChars: 50, minPhotos: 1, maxPhotos: 5, videoRequired: true });
    expect(evidenceRequirement("DAMAGE_ON_RETURN", "REPORTER").videoRequired).toBe(true);
    expect(evidenceRequirement("RETURN_CHECK", "REPORTER").videoRequired).toBe(false);
  });

  it("an answer needs only a statement; photos and a video are optional", () => {
    expect(evidenceRequirement("DAMAGE_ON_RETURN", "RESPONDENT")).toMatchObject({ minStatementChars: 20, minPhotos: 0, videoRequired: false });
  });

  it("every missing piece is named in plain words", () => {
    const p = evidenceProblems(evidenceRequirement("DAMAGE_ON_RETURN", "REPORTER"), { statement: "short", photos: 0, videos: 0 });
    expect(p).toHaveLength(3);
    expect(p.join(" ")).toMatch(/at least 50 characters/);
    expect(p.join(" ")).toMatch(/at least 1 photo/);
    expect(p.join(" ")).toMatch(/video/);
    expect(evidenceProblems(evidenceRequirement("DAMAGE_ON_RETURN", "REPORTER"), { statement: "x".repeat(60), photos: 2, videos: 1 })).toEqual([]);
  });
});

describe("report windows (ruling 1)", () => {
  const base: WindowFacts = {
    viewer: "RENTER",
    status: "ACTIVE",
    verificationStatus: null,
    claimedAt: t0,
    depositHoldUntil: null,
    depositRefunded: false,
    blockedKinds: [],
  };
  const w = (f: Partial<WindowFacts>, now: Date) =>
    Object.fromEntries(reportWindows({ ...base, ...f }, now).map((x) => [x.kind, x]));

  it("the renter can report a defect until 24 h after pickup, then not", () => {
    expect(w({}, at(23)).DEFECT_ON_RECEIPT.canReport).toBe(true);
    expect(w({}, at(23)).DEFECT_ON_RECEIPT.closesAt).toEqual(at(24));
    const late = w({}, at(25)).DEFECT_ON_RECEIPT;
    expect(late.canReport).toBe(false);
    expect(late.reason).toMatch(/within 24 hours of pickup/);
  });

  it("the owner cannot report a defect, and the renter cannot report damage", () => {
    expect(w({ viewer: "OWNER" }, at(1)).DEFECT_ON_RECEIPT.canReport).toBe(false);
    expect(w({ viewer: "RENTER", status: "VERIFICATION", verificationStatus: "APPROVED", depositHoldUntil: at(72) }, at(1)).DAMAGE_ON_RETURN.canReport).toBe(false);
  });

  it("the owner can report damage while the deposit is held, after approval and after collecting", () => {
    const owner = { viewer: "OWNER" as const, verificationStatus: "APPROVED", depositHoldUntil: at(48) };
    expect(w({ ...owner, status: "VERIFICATION" }, at(10)).DAMAGE_ON_RETURN.canReport).toBe(true);
    expect(w({ ...owner, status: "COMPLETED" }, at(10)).DAMAGE_ON_RETURN.closesAt).toEqual(at(48));
    expect(w({ ...owner, status: "COMPLETED" }, at(49)).DAMAGE_ON_RETURN.canReport).toBe(false);
    expect(w({ ...owner, status: "COMPLETED", depositRefunded: true }, at(10)).DAMAGE_ON_RETURN.canReport).toBe(false);
  });

  // D-117: each closed state says what actually happened.
  it("says why damage cannot be reported: already reported, refunded, no hold, or time passed", () => {
    const owner = { viewer: "OWNER" as const, status: "COMPLETED", verificationStatus: "APPROVED" };
    expect(w({ ...owner, depositHoldUntil: null, blockedKinds: ["DAMAGE_ON_RETURN"] }, at(10)).DAMAGE_ON_RETURN.reason).toMatch(/already been reported/);
    expect(w({ ...owner, depositHoldUntil: at(48), depositRefunded: true }, at(10)).DAMAGE_ON_RETURN.reason).toMatch(/deposit has been refunded/);
    const noHold = w({ ...owner, depositHoldUntil: null }, at(10)).DAMAGE_ON_RETURN.reason!;
    expect(noHold).toMatch(/settled without that hold/);
    expect(noHold).not.toMatch(/refunded/);
    expect(w({ ...owner, depositHoldUntil: at(48) }, at(49)).DAMAGE_ON_RETURN.reason).toBe("The time to report damage on this return has passed.");
  });

  it("not before the return is approved, and not twice while a case is open", () => {
    expect(w({ viewer: "OWNER", status: "VERIFICATION", verificationStatus: "MANUAL_REVIEW", depositHoldUntil: at(48) }, at(1)).DAMAGE_ON_RETURN.canReport).toBe(false);
    expect(w({ blockedKinds: ["DEFECT_ON_RECEIPT"] }, at(1)).DEFECT_ON_RECEIPT.reason).toMatch(/already been reported/);
  });

  it("a return-check concern only while the return is still being checked, for either student", () => {
    expect(w({ status: "VERIFICATION", verificationStatus: "MANUAL_REVIEW" }, at(1)).RETURN_CHECK.canReport).toBe(true);
    expect(w({ viewer: "OWNER", status: "VERIFICATION", verificationStatus: "PENDING" }, at(1)).RETURN_CHECK.canReport).toBe(true);
    expect(w({ status: "VERIFICATION", verificationStatus: "APPROVED" }, at(1)).RETURN_CHECK.canReport).toBe(false);
  });
});

describe("defect refund (rulings 3 + 4)", () => {
  const rental = { rent: 300, startDate: t0, endDate: at(72), claimedAt: at(1) };
  it("within 3 h of pickup: the whole rent is the base", () => {
    const r = defectRefund({ ...rental, reportedAt: at(3.5), responsibilityPct: 100 });
    expect(r.fullBecauseEarly).toBe(true);
    expect(r.refund).toBe(300);
  });
  it("later: only the unused days, times the owner's share", () => {
    const r = defectRefund({ ...rental, reportedAt: at(24), responsibilityPct: 50 });
    expect(r.fullBecauseEarly).toBe(false);
    expect(r.base).toBe(200); // 48 of 72 h left
    expect(r.refund).toBe(100);
  });
  it("0% gives nothing back; the percentage is clamped", () => {
    expect(defectRefund({ ...rental, reportedAt: at(2), responsibilityPct: 0 }).refund).toBe(0);
    expect(defectRefund({ ...rental, reportedAt: at(2), responsibilityPct: 140 }).refund).toBe(300);
  });
});

describe("damage outcome (ruling 4)", () => {
  it("the renter's share comes from the deposit first, the rest is owed", () => {
    expect(damageOutcome({ assessedAmount: 800, cap: 1000, responsibilityPct: 50, depositAvailable: 300 })).toEqual({
      assessed: 800,
      charge: 400,
      fromDeposit: 300,
      owed: 100,
      depositBack: 0,
      capped: false,
    });
  });
  it("a small charge leaves the rest of the deposit to refund", () => {
    expect(damageOutcome({ assessedAmount: 200, cap: 1000, responsibilityPct: 50, depositAvailable: 300 })).toMatchObject({
      charge: 100,
      fromDeposit: 100,
      owed: 0,
      depositBack: 200,
    });
  });
  it("the assessed damage can never exceed the cap", () => {
    expect(damageOutcome({ assessedAmount: 5000, cap: 1000, responsibilityPct: 100, depositAvailable: 300 })).toMatchObject({
      assessed: 1000,
      charge: 1000,
      owed: 700,
      capped: true,
    });
  });
  it("the cap is the replacement value, or the larger of the deposit and 30 days of rent", () => {
    expect(damageCap(1500, 300, 20)).toEqual({ cap: 1500, source: "REPLACEMENT_VALUE" });
    expect(damageCap(null, 300, 20)).toEqual({ cap: 600, source: "FALLBACK" });
    expect(damageCap(null, 900, 20)).toEqual({ cap: 900, source: "FALLBACK" });
  });
});

describe("decision wording", () => {
  it("the status follows the percentage", () => {
    expect(decisionStatus(0)).toBe("NOT_UPHELD");
    expect(decisionStatus(40)).toBe("PARTLY_UPHELD");
    expect(decisionStatus(100)).toBe("UPHELD");
  });
  it("explains the money in the same numbers it moves by", () => {
    const text = explainDecision("DAMAGE_ON_RETURN", 50, { assessed: 800, charge: 400, fromDeposit: 300, owed: 100, depositBack: 0 });
    expect(text).toMatch(/₱800\.00/);
    expect(text).toMatch(/50% responsible: ₱400\.00/);
    expect(text).toMatch(/remaining ₱100\.00 is owed/);
    expect(explainDecision("DEFECT_ON_RECEIPT", 0, {})).toMatch(/not responsible/);
  });
});
