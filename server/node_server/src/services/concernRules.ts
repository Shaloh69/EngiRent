/**
 * Concerns v2 — the pure rules (user rulings 2026-10-13; spec
 * docs/redesign/SPEC-CONCERNS-V2.md). No Prisma, no clock of its own: every
 * window, evidence requirement and peso amount a student or an admin sees comes
 * from here, so the app, the admin console and the decision itself cannot
 * disagree about them.
 */

export type ConcernKindName = "DEFECT_ON_RECEIPT" | "DAMAGE_ON_RETURN" | "RETURN_CHECK";
export type PartyName = "RENTER" | "OWNER";

/** Ruling 1: the renter may report a defect until this long after pickup. */
export const DEFECT_WINDOW_HOURS = 24;
/** Ruling 6: the other student has this long to answer before an admin decides. */
export const RESPONSE_WINDOW_HOURS = 24;
/** Ruling 3: a defect reported this soon after pickup gets the whole rent back. */
export const FULL_REFUND_WITHIN_HOURS = 3;
/** Ruling 7: upheld cases against one student in this many days trigger a review flag. */
export const REPEAT_WINDOW_DAYS = 90;
export const REPEAT_THRESHOLD = 2;
/** Same fallback as Dispute v2 when the owner has not stated a replacement value. */
export const FALLBACK_CAP_DAYS = 30;
/** Once a defect is upheld, the renter has this long to bring the item back. */
export const EARLY_RETURN_HOURS = 24;

const HOUR = 3_600_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface EvidenceRequirement {
  minStatementChars: number;
  maxStatementChars: number;
  minPhotos: number;
  maxPhotos: number;
  videoRequired: boolean;
  maxVideos: number;
}

/** Ruling 5: a video is required for the two damage kinds; answers may add one. */
export function evidenceRequirement(kind: ConcernKindName, role: "REPORTER" | "RESPONDENT"): EvidenceRequirement {
  if (role === "RESPONDENT") {
    return { minStatementChars: 20, maxStatementChars: 2000, minPhotos: 0, maxPhotos: 5, videoRequired: false, maxVideos: 1 };
  }
  return {
    minStatementChars: 50,
    maxStatementChars: 2000,
    minPhotos: 1,
    maxPhotos: 5,
    videoRequired: kind !== "RETURN_CHECK",
    maxVideos: 1,
  };
}

/** The problems with a submission, in plain words; empty when it is acceptable. */
export function evidenceProblems(
  req: EvidenceRequirement,
  got: { statement: string; photos: number; videos: number },
): string[] {
  const problems: string[] = [];
  const len = got.statement.trim().length;
  if (len < req.minStatementChars) problems.push(`Describe the problem in at least ${req.minStatementChars} characters (you wrote ${len}).`);
  if (len > req.maxStatementChars) problems.push(`Keep the description under ${req.maxStatementChars} characters.`);
  if (got.photos < req.minPhotos) problems.push(`Add at least ${req.minPhotos} photo${req.minPhotos === 1 ? "" : "s"}.`);
  if (got.photos > req.maxPhotos) problems.push(`Add at most ${req.maxPhotos} photos.`);
  if (req.videoRequired && got.videos < 1) problems.push("Add a short video (up to 30 seconds) showing the problem.");
  if (got.videos > req.maxVideos) problems.push("Add only one video.");
  return problems;
}

/** What the reporting window looks like for one kind, for the app and the server alike. */
export interface ReportWindow {
  kind: ConcernKindName;
  canReport: boolean;
  /** Why not, in plain words (null when canReport). */
  reason: string | null;
  /** When the window closes (null when it has no fixed end, or is closed). */
  closesAt: Date | null;
}

export interface WindowFacts {
  viewer: PartyName;
  status: string; // rental status
  verificationStatus: string | null;
  claimedAt: Date | null;
  depositHoldUntil: Date | null;
  depositRefunded: boolean;
  /**
   * Kinds that cannot be reported again on this rental: DEFECT_ON_RECEIPT and
   * DAMAGE_ON_RETURN once reported at all (one of each per rental, decided or
   * not), RETURN_CHECK while one is still open.
   */
  blockedKinds: ConcernKindName[];
}

/** Ruling 1 windows, per kind, for whoever is looking. */
export function reportWindows(f: WindowFacts, now: Date): ReportWindow[] {
  const open = (k: ConcernKindName) => f.blockedKinds.includes(k);
  const out: ReportWindow[] = [];

  // DEFECT_ON_RECEIPT — the renter, from pickup until 24 h after it.
  {
    const closesAt = f.claimedAt ? new Date(f.claimedAt.getTime() + DEFECT_WINDOW_HOURS * HOUR) : null;
    let reason: string | null = null;
    if (f.viewer !== "RENTER") reason = "Only the renter can report a problem with the item they received.";
    else if (f.status !== "ACTIVE" || !f.claimedAt) reason = "You can report this once you have picked the item up.";
    else if (closesAt && now > closesAt) reason = `Problems with the item must be reported within ${DEFECT_WINDOW_HOURS} hours of pickup.`;
    else if (open("DEFECT_ON_RECEIPT")) reason = "A problem with this item has already been reported on this rental; see the case.";
    out.push({ kind: "DEFECT_ON_RECEIPT", canReport: reason === null, reason, closesAt: reason === null ? closesAt : null });
  }

  // DAMAGE_ON_RETURN — the owner, while the renter's deposit is still held.
  {
    let reason: string | null = null;
    const approved = f.verificationStatus === "APPROVED" && (f.status === "VERIFICATION" || f.status === "COMPLETED");
    if (f.viewer !== "OWNER") reason = "Only the owner can report damage to a returned item.";
    else if (!approved) reason = "You can report damage once the return has been approved.";
    else if (f.depositRefunded || !f.depositHoldUntil || now > f.depositHoldUntil)
      reason = "The time to report damage on this return has passed and the deposit has been refunded.";
    else if (open("DAMAGE_ON_RETURN")) reason = "Damage on this return has already been reported; see the case.";
    out.push({ kind: "DAMAGE_ON_RETURN", canReport: reason === null, reason, closesAt: reason === null ? f.depositHoldUntil : null });
  }

  // RETURN_CHECK — either student, while the return is still being checked.
  {
    let reason: string | null = null;
    if (f.status !== "VERIFICATION" || f.verificationStatus === "APPROVED")
      reason = "This is only for a return that is still being checked.";
    else if (open("RETURN_CHECK")) reason = "A concern about this return is already with an admin.";
    out.push({ kind: "RETURN_CHECK", canReport: reason === null, reason, closesAt: null });
  }
  return out;
}

export interface DefectRefundInput {
  rent: number; // the rental payment
  startDate: Date;
  endDate: Date;
  claimedAt: Date | null;
  reportedAt: Date;
  responsibilityPct: number; // the owner's share, 0-100
}

/** Ruling 3 x ruling 4: the rent given back when a defect is (partly) upheld. */
export function defectRefund(i: DefectRefundInput): {
  base: number;
  refund: number;
  fullBecauseEarly: boolean;
  unusedFraction: number;
} {
  const pct = clampPct(i.responsibilityPct);
  const early = i.claimedAt != null && i.reportedAt.getTime() - i.claimedAt.getTime() <= FULL_REFUND_WITHIN_HOURS * HOUR;
  const span = Math.max(1, i.endDate.getTime() - i.startDate.getTime());
  const unused = Math.min(1, Math.max(0, (i.endDate.getTime() - i.reportedAt.getTime()) / span));
  const base = round2(early ? i.rent : i.rent * unused);
  return { base, refund: round2((base * pct) / 100), fullBecauseEarly: early, unusedFraction: unused };
}

export interface DamageInput {
  assessedAmount: number; // what the admin judged the damage to be worth
  cap: number; // replacement value, or the fallback
  responsibilityPct: number; // the renter's share, 0-100
  depositAvailable: number; // held deposit not yet refunded, minus anything already deducted
}

/** Ruling 4: the renter's share of the damage, from the held deposit first, the rest owed. */
export function damageOutcome(i: DamageInput): {
  assessed: number;
  charge: number;
  fromDeposit: number;
  owed: number;
  depositBack: number;
  capped: boolean;
} {
  const pct = clampPct(i.responsibilityPct);
  const assessed = round2(Math.max(0, Math.min(i.assessedAmount, i.cap)));
  const charge = round2((assessed * pct) / 100);
  const available = Math.max(0, i.depositAvailable);
  const fromDeposit = round2(Math.min(charge, available));
  return {
    assessed,
    charge,
    fromDeposit,
    owed: round2(charge - fromDeposit),
    depositBack: round2(available - fromDeposit),
    capped: i.assessedAmount > i.cap,
  };
}

export function damageCap(replacementValue: number | null | undefined, deposit: number, pricePerDay: number): {
  cap: number;
  source: "REPLACEMENT_VALUE" | "FALLBACK";
} {
  if (replacementValue != null && replacementValue > 0) return { cap: replacementValue, source: "REPLACEMENT_VALUE" };
  return { cap: Math.max(deposit, pricePerDay * FALLBACK_CAP_DAYS), source: "FALLBACK" };
}

export function clampPct(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.min(100, Math.max(0, Math.round(p)));
}

/** Ruling 4: the status a decision ends in, from the responsibility the admin set. */
export function decisionStatus(pct: number): "UPHELD" | "PARTLY_UPHELD" | "NOT_UPHELD" {
  const p = clampPct(pct);
  return p === 0 ? "NOT_UPHELD" : p === 100 ? "UPHELD" : "PARTLY_UPHELD";
}

export const KIND_TITLE: Record<ConcernKindName, string> = {
  DEFECT_ON_RECEIPT: "Problem with the item received",
  DAMAGE_ON_RETURN: "Damage found after the return",
  RETURN_CHECK: "Concern about a return being checked",
};

const peso = (n: number) => `₱${n.toFixed(2)}`;

/**
 * The plain explanation of a decision that both students read (and the admin
 * previews before deciding). Built from the same numbers the money moves by.
 */
export function explainDecision(
  kind: ConcernKindName,
  pct: number,
  money: { refund?: number; fullBecauseEarly?: boolean; charge?: number; fromDeposit?: number; owed?: number; assessed?: number; depositBack?: number },
  returnBy?: Date | null,
): string {
  const p = clampPct(pct);
  if (kind === "RETURN_CHECK") return "The admin has looked at this concern together with the return check.";
  if (p === 0) {
    return kind === "DEFECT_ON_RECEIPT"
      ? "The admin found that the owner is not responsible for this problem. The rental continues as booked."
      : "The admin found that the renter is not responsible for this damage. Nothing is charged and the deposit is refunded in full.";
  }
  if (kind === "DEFECT_ON_RECEIPT") {
    const lines = [
      `The admin found the owner ${p}% responsible for the problem with the item.`,
      money.refund && money.refund > 0
        ? `${peso(money.refund)} of the rent is given back to the renter${money.fullBecauseEarly ? " (reported within 3 hours of pickup, so the refund is based on the whole rent)" : " (based on the days not yet used)"}.`
        : "No rent is given back.",
    ];
    if (returnBy) {
      lines.push(
        `The renter returns the item at the kiosk by ${returnBy.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })}, with no late fee. The deposit is refunded after the return as usual.`,
      );
    }
    lines.push("The owner's listing is paused until they confirm the item is fixed.");
    return lines.join(" ");
  }
  const lines = [
    `The admin assessed the damage at ${peso(money.assessed ?? 0)} and found the renter ${p}% responsible: ${peso(money.charge ?? 0)}.`,
    `${peso(money.fromDeposit ?? 0)} is taken from the held deposit and paid to the owner; ${peso(money.depositBack ?? 0)} of the deposit is refunded to the renter.`,
  ];
  if ((money.owed ?? 0) > 0) {
    lines.push(`The remaining ${peso(money.owed ?? 0)} is owed by the renter. Their account is limited until it is paid; they can pay from the case in the app.`);
  }
  return lines.join(" ");
}
