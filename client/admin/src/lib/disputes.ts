/**
 * Dispute System v2 (user rulings 2026-10-11) — the shapes the admin console
 * reads from /admin/disputes. The server is the source of every number and
 * every sentence here; the console only lays them out.
 */

export const DISPUTE_STATUS_LABEL: Record<string, string> = {
  OPEN: "Open: waiting for payment",
  PAYMENT_PENDING: "Payment submitted",
  PAID: "Paid: waiting for the return",
  RETURN_REVIEW: "Return placed: needs your review",
  RESOLVED: "Resolved",
  CANCELLED: "Cancelled",
};

export const DISPUTE_STATUS_COLOR: Record<string, string> = {
  OPEN: "danger",
  PAYMENT_PENDING: "warn",
  PAID: "review",
  RETURN_REVIEW: "review",
  RESOLVED: "emerald",
  CANCELLED: "gray",
};

export const OFFICE_LABEL: Record<string, string> = {
  SAO: "Student Affairs Office (SAO)",
  ENGINEERING: "Engineering Faculty",
  GUIDANCE: "Guidance Office",
};

export const pesoFmt = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

export function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** "2 d 4 h left" / "overdue by 3 h". */
export function countdown(iso: string | null | undefined, now = Date.now()): { text: string; overdue: boolean } {
  if (!iso) return { text: "—", overdue: false };
  const ms = new Date(iso).getTime() - now;
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const span = d > 0 ? `${d} d ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`;
  return ms >= 0 ? { text: `${span} left`, overdue: false } : { text: `overdue by ${span}`, overdue: true };
}

export interface PlainVerdict {
  headline: string;
  points: string[];
  source: "full" | "quick" | "none";
  score: number | null;
}

export interface DisputeListRow {
  id: string;
  referenceNo: string;
  rentalId: string;
  itemTitle: string;
  renter: { firstName: string; lastName: string; studentId: string };
  owner: { firstName: string; lastName: string };
  status: string;
  resolution: string | null;
  offense: number;
  openedAt: string;
  deadlineAt: string;
  escalatedAt: string | null;
  reviewRequestedAt: string | null;
  owed: number;
  paid: number;
  pending: number;
  wrongItemWaiting: boolean;
  wrongItemMoving: boolean;
  pendingTransaction: { id: string; amount: number; paymentMethod: string; createdAt: string } | null;
  visitExpiresAt: number | null;
}

export interface LegacyRow {
  id: string;
  updatedAt: string;
  item: { title: string };
  renter: { firstName: string; lastName: string };
  owner: { firstName: string; lastName: string };
  releaseReason: string | null;
  releasedAt: string | null;
  retrievedAt: string | null;
}

export interface DisputeEvent {
  id: string;
  type: string;
  actorRole: string;
  actorId: string | null;
  audience: string | null;
  channel: string | null;
  title: string | null;
  message: string | null;
  outcome: string | null;
  createdAt: string;
}

export interface DisputeLetter {
  id: string;
  office: string;
  referenceNo: string;
  content: LetterContent;
  generatedAt: string;
  generatedById: string | null;
  submittedAt: string | null;
  submissionNote: string | null;
}

export interface LetterContent {
  subject: string;
  addressee: string[];
  date: string;
  salutation: string;
  paragraphs: string[];
  facts: Array<[string, string]>;
  timeline: Array<{ at: string; what: string }>;
  contacts: Array<{ at: string; who: string; channel: string; outcome: string; note: string }>;
  outstanding: string;
  request: string;
  privacy: string;
  attachments: string[];
  signatory: { name: string; title: string; organisation: string };
}

export interface DisputeCase {
  dispute: {
    id: string;
    referenceNo: string;
    rentalId: string;
    status: string;
    resolution: string | null;
    resolutionNote: string | null;
    offense: number;
    openedAt: string;
    deadlineAt: string;
    deadlineHours: number;
    escalatedAt: string | null;
    reviewRequestedAt: string | null;
    resolvedAt: string | null;
    reminderStage: number;
    aiSummary: string | null;
  };
  rental: {
    id: string;
    status: string;
    startDate: string;
    endDate: string;
    returnedAt: string | null;
    totalPrice: number;
    securityDeposit: number;
    item: { id: string; title: string; images: string[]; pricePerDay: number; replacementValue: number | null };
    renter: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      phoneNumber: string;
      studentId: string;
      parentName: string | null;
      parentContact: string | null;
      restrictedUntilReviewAt: string | null;
      restrictionNote: string | null;
    };
    owner: { id: string; firstName: string; lastName: string; email: string; phoneNumber: string; studentId: string };
    returnLocker: { lockerNumber: string } | null;
    verification: { id: string; kioskImages: string[]; originalImages: string[]; confidenceScore: number; createdAt: string } | null;
  };
  aiVerdict: PlainVerdict | null;
  money: {
    owed: number;
    owedAfterPending: number;
    paid: number;
    pending: number;
    lateFeeCredit: number;
    feeBase: number;
    feeCap: number;
    feeCapSource: "REPLACEMENT_VALUE" | "FALLBACK";
    feeCapAtOpen: number;
    feeStartAt: string;
    frozen: boolean;
    statement: {
      days: number;
      accrued: number;
      uncapped: number;
      capped: boolean;
      nextDayCharge: number;
      lines: Array<{ fromDay: number; toDay: number; days: number; multiplier: number; perDay: number; amount: number }>;
    };
    schedule: Array<{ fromDay: number; toDay: number | null; multiplier: number; perDay: number }>;
  };
  wrongItem: {
    lockerNumber: string | null;
    door: string | null;
    moving: boolean;
    collectable: boolean;
    collectedAt: string | null;
  } | null;
  visit: { expiresAt: number; transactionId: string | null; doorGranted: boolean; kioskId: string } | null;
  events: DisputeEvent[];
  letters: DisputeLetter[];
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    status: string;
    paymentMethod: string;
    createdAt: string;
    paidAt: string | null;
    disputeId: string | null;
  }>;
}

export const ACTIVE_STATUSES = ["OPEN", "PAYMENT_PENDING", "PAID", "RETURN_REVIEW"];
