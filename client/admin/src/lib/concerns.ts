/**
 * Concerns v2 (user rulings 2026-10-13) — the shapes the admin console reads
 * from /admin/concerns. Every number and every sentence a student will read is
 * computed by the server (concernRules.ts); the console only lays them out.
 */

export { pesoFmt, when, countdown } from "./disputes";

export type ConcernKind = "DEFECT_ON_RECEIPT" | "DAMAGE_ON_RETURN" | "RETURN_CHECK";
export type ConcernStatus = "AWAITING_RESPONSE" | "UNDER_REVIEW" | "UPHELD" | "PARTLY_UPHELD" | "NOT_UPHELD" | "CLOSED";

export const OPEN_CONCERN_STATUSES: ConcernStatus[] = ["AWAITING_RESPONSE", "UNDER_REVIEW"];

export const CONCERN_STATUS_LABEL: Record<ConcernStatus, string> = {
  AWAITING_RESPONSE: "Waiting for the other student",
  UNDER_REVIEW: "Ready for your decision",
  UPHELD: "Upheld",
  PARTLY_UPHELD: "Partly upheld",
  NOT_UPHELD: "Not upheld",
  CLOSED: "Closed",
};

export const CONCERN_STATUS_COLOR: Record<ConcernStatus, string> = {
  AWAITING_RESPONSE: "review",
  UNDER_REVIEW: "warn",
  UPHELD: "danger",
  PARTLY_UPHELD: "gold",
  NOT_UPHELD: "emerald",
  CLOSED: "gray",
};

/**
 * The badge for a case. `settled` comes from the server (a decided damage case
 * with nothing left to pay): the ruling stays upheld, but the case is finished.
 */
export function concernBadge(status: ConcernStatus, settled?: boolean): { label: string; color: string } {
  if (settled && (status === "UPHELD" || status === "PARTLY_UPHELD")) {
    return { label: `Settled · ${CONCERN_STATUS_LABEL[status].toLowerCase()}`, color: "emerald" };
  }
  return { label: CONCERN_STATUS_LABEL[status], color: CONCERN_STATUS_COLOR[status] };
}

/** What each kind means, in one line, for the list and the case header. */
export const KIND_EXPLAINED: Record<ConcernKind, string> = {
  DEFECT_ON_RECEIPT: "The renter says the item was broken or incomplete when they picked it up.",
  DAMAGE_ON_RETURN: "The owner says the item came back damaged in a way the locker camera could not see.",
  RETURN_CHECK: "A student added information while a return was being checked.",
};

/** Who the responsibility percentage is about, per kind. */
export const RESPONSIBLE_PARTY: Record<ConcernKind, string> = {
  DEFECT_ON_RECEIPT: "owner",
  DAMAGE_ON_RETURN: "renter",
  RETURN_CHECK: "",
};

export interface ConcernListRow {
  id: string;
  referenceNo: string;
  kind: ConcernKind;
  title: string;
  status: ConcernStatus;
  itemTitle: string;
  reporter: string;
  reporterParty: "RENTER" | "OWNER";
  respondent: string;
  responseDueAt: string;
  respondedAt: string | null;
  ready: boolean;
  photos: number;
  videos: number;
  amountOwed: number | null;
  owedPaidAt: string | null;
  settled?: boolean;
  repeatFlag: boolean;
  createdAt: string;
  decidedAt: string | null;
}

export interface ConcernEvidenceRow {
  id: string;
  authorId: string;
  authorParty: "RENTER" | "OWNER" | null;
  type: "STATEMENT" | "PHOTO" | "VIDEO";
  text: string | null;
  url: string | null;
  mime: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

export interface ConcernPreview {
  kind: ConcernKind;
  status: string;
  pct: number;
  explanation: string;
  // defect
  refund?: number;
  refundBase?: number;
  fullBecauseEarly?: boolean;
  returnBy?: string | null;
  // damage
  assessed?: number;
  charge?: number;
  fromDeposit?: number;
  owed?: number;
  depositBack?: number;
  capped?: boolean;
  facts: {
    deposit: number;
    rent: number;
    depositRefunded: boolean;
    depositAvailable: number;
    cap: { cap: number; source: "REPLACEMENT_VALUE" | "FALLBACK" };
  };
}

export interface ConcernDetail {
  id: string;
  referenceNo: string;
  kind: ConcernKind;
  title: string;
  status: ConcernStatus;
  reporterParty: "RENTER" | "OWNER";
  reporter: { id: string; firstName: string; lastName: string; email: string; studentId: string };
  respondent: { id: string; firstName: string; lastName: string; email: string; studentId: string };
  responseDueAt: string;
  respondedAt: string | null;
  createdAt: string;
  decidedAt: string | null;
  responsibilityPct: number | null;
  assessedAmount: number | null;
  refundAmount: number | null;
  chargeAmount: number | null;
  fromDeposit: number | null;
  amountOwed: number | null;
  owedPaidAt: string | null;
  settled?: boolean;
  decisionNote: string | null;
  repeatFlag: boolean;
  rental: {
    id: string;
    status: string;
    startDate: string;
    endDate: string;
    claimedAt: string | null;
    depositHoldUntil: string | null;
    item: { id: string; title: string; replacementValue: number | null; pricePerDay: number; securityDeposit: number };
  };
  evidence: ConcernEvidenceRow[];
  events: { id: string; type: string; actor: string; message: string; createdAt: string }[];
  lockerPhotos: {
    deposit: { kioskImages: string[]; at: string | null };
    return: { kioskImages: string[]; at: string | null };
    listing: { images: string[] };
  };
  preview: ConcernPreview;
  pendingPayment: { id: string; amount: number; paymentReferenceNo: string | null; createdAt: string } | null;
  priorUpheldAgainstRespondent: number;
}

export const partyLabel = (p: "RENTER" | "OWNER" | null | undefined) => (p === "RENTER" ? "Renter" : p === "OWNER" ? "Owner" : "Admin");
