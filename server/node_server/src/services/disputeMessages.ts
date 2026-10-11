/**
 * Dispute v2 — every sentence a renter or owner is shown about a case.
 *
 * Pure text builders, so the wording can be tested and so the admin can be
 * shown exactly what was sent (the event log stores the output verbatim).
 *
 * The prompt may only promise what really happens (ruling 12). Each
 * consequence below is a real action in this system: personnel contact is
 * logged in the case (the system cannot phone anyone), the guardian is on
 * record (required at registration), the three UCLM letters are generated for
 * the admin to submit, the ban is the admin's "close as unrecovered", and the
 * owner's claim is recorded the same way.
 */

export interface MessageContext {
  reference: string;
  itemTitle: string;
  offense: number;
  returnedAt: Date | null;
  lockerNumber: string | null;
  wrongItemDoor: string | null;
  deadlineAt: Date;
  deadlineHours: number;
  feeBase: number;
  feeCap: number;
  /** Where the cap comes from: the owner's stated replacement value, or the
   *  interim fallback (deposit or 30 days of the daily price, whichever is larger). */
  feeCapSource?: "REPLACEMENT_VALUE" | "FALLBACK";
  feeStartAt: Date;
  owed: number;
  aiHeadline: string | null;
}

export const UCLM = "the University of Cebu Lapu-Lapu and Mandaue (UCLM)";
export const UCLM_OFFICES = "the UCLM Student Affairs Office (SAO), the Engineering Faculty and the Guidance Office";

export const peso = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function formatWhen(d: Date | null): string {
  if (!d) return "an unknown time";
  return d.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function deadlineWords(hours: number): string {
  if (hours <= 24) return "24 hours";
  if (hours <= 48) return "2 days";
  return "3 days";
}

const doorWords = (door: string | null) => (door === "bottom_door" ? "lower door" : "upper door");

function lockerPhrase(c: MessageContext): string {
  return c.lockerNumber ? `locker ${c.lockerNumber}, ${doorWords(c.wrongItemDoor)}` : "the locker you used";
}

function capText(c: Pick<MessageContext, "feeCap" | "feeCapSource">): string {
  return c.feeCapSource === "REPLACEMENT_VALUE"
    ? `up to the item's replacement value of ${peso(c.feeCap)}`
    : `up to ${peso(c.feeCap)} (30 days of the daily price or the deposit, whichever is larger, until the owner states the item's replacement value)`;
}

export function feeScheduleText(
  c: Pick<MessageContext, "offense" | "feeBase" | "feeCap" | "feeStartAt" | "feeCapSource">,
): string {
  if (c.offense >= 2) {
    return (
      `Fees restart now at twice the item's daily price (${peso(c.feeBase * 2)} a day) and rise to three times ` +
      `(${peso(c.feeBase * 3)} a day) from day 3, ${capText(c)}. Fees you already paid on the first case are kept.`
    );
  }
  return (
    `Fees are the item's daily price (${peso(c.feeBase)}), counted from ${formatWhen(c.feeStartAt)}: ` +
    `days 1-3 at ${peso(c.feeBase)} a day, days 4-7 at ${peso(c.feeBase * 1.5)} a day, and from day 8 at ` +
    `${peso(c.feeBase * 2)} a day, ${capText(c)}.`
  );
}

export function renterPromptTitle(c: Pick<MessageContext, "offense" | "deadlineHours">): string {
  return c.offense >= 2
    ? "Second wrong item: account suspended, action required within 24 hours"
    : `Return disputed: action required within ${deadlineWords(c.deadlineHours)}`;
}

/** The full-screen prompt (agreed draft, reordered for paying at the kiosk). */
export function renterPrompt(c: MessageContext): string {
  const what =
    `What happened: on ${formatWhen(c.returnedAt)} you returned an item for "${c.itemTitle}" ` +
    `at ${c.lockerNumber ? `locker ${c.lockerNumber}` : "the kiosk"}. Our AI flagged it, and an admin reviewed the ` +
    `locker photos and confirmed it is not the listed item.` +
    (c.aiHeadline ? ` What the AI saw: ${c.aiHeadline}` : "");

  const partnership = `EngiRent operates in partnership with ${UCLM}. Case reference: ${c.reference}.`;

  const restricted =
    c.offense >= 2
      ? "This is your SECOND wrong item. Your account is suspended until an admin reviews it. Until then you can only view this case, collect your own item, pay, return the correct item, and request a review or contact support."
      : "Your account is restricted until this is resolved. Until then you can only view this case, collect your own item, pay, return the correct item, and request a review or contact support.";

  const steps =
    `What to do, by ${formatWhen(c.deadlineAt)}:\n` +
    `1. Go to the kiosk, scan the QR code and pay the amount owed (${peso(c.owed)} now). The amount stops growing once you pay.\n` +
    `2. Put the correct ${c.itemTitle} in the locker when the upper door opens.\n` +
    `3. Collect the item you left from ${lockerPhrase(c)}, at any time. You do not need to pay first: it is yours.`;

  const fees = `${feeScheduleText(c)} Current total: ${peso(c.owed)}.`;

  const consequences =
    c.offense >= 2
      ? `Because this is a repeat, our personnel will contact your parent or guardian on record and report the case to ${UCLM_OFFICES} for disciplinary action under the Student Code of Conduct. If you do not comply within 24 hours, the case may be referred to the proper authorities, your account may be permanently banned, and the owner may claim the item's full value.`
      : `If you do not comply: our personnel will contact you by email and phone; if you cannot be reached, your parent or guardian on record. The case will be reported to ${UCLM_OFFICES} for disciplinary action under the Student Code of Conduct, and may be referred to the proper authorities. Your account may be permanently banned, and the owner may claim the item's full value.`;

  const review = "Think this is a mistake? Request a review or contact support from this case in the app.";

  return [what, partnership, restricted, steps, fees, consequences, review].join("\n\n");
}

export function ownerNoticeTitle(): string {
  return "Your item's return is under dispute";
}

export function ownerNotice(c: MessageContext): string {
  return [
    `The item placed in the locker for the return of your "${c.itemTitle}" did not match your listing, and an admin has confirmed it after reviewing the locker photos.` +
      (c.aiHeadline ? ` What the AI saw: ${c.aiHeadline}` : ""),
    "You do not need to do anything. The renter must return your item; we will tell you as soon as it is back and checked, and then you can collect it at the kiosk.",
    `Your payout for this rental is on hold until then. Case reference: ${c.reference}.`,
  ].join("\n\n");
}

export function reminderTitle(stage: number): string {
  if (stage >= 3) return "Dispute deadline reached: case escalated";
  if (stage === 2) return "Dispute reminder: 1 day left";
  return "Dispute reminder: action still required";
}

export function reminderText(c: MessageContext, stage: number): string {
  if (stage >= 3) {
    return [
      `The deadline for case ${c.reference} (${c.itemTitle}) passed on ${formatWhen(c.deadlineAt)}.`,
      `The case has been escalated. Our personnel will now contact you by email and phone and, if you cannot be reached, your parent or guardian on record. The case will be reported to ${UCLM_OFFICES}.`,
      `You can still resolve it: go to the kiosk, pay the amount owed (${peso(c.owed)} now) and return the correct item. Fees keep rising until you pay.`,
    ].join("\n\n");
  }
  return [
    `Case ${c.reference}: the correct ${c.itemTitle} has not been returned yet. The deadline is ${formatWhen(c.deadlineAt)}.`,
    `Amount owed now: ${peso(c.owed)}. ${feeScheduleText(c)}`,
    `Go to the kiosk, scan the QR code, pay, and place the correct item when the upper door opens. You can collect the item you left from ${lockerPhrase(c)} at any time.`,
  ].join("\n\n");
}

export function resolvedRenterText(reference: string, itemTitle: string): string {
  return `Case ${reference} is closed: the correct ${itemTitle} was returned and confirmed by an admin. Thank you. Your account is no longer restricted by this case.`;
}

export function overturnedRenterText(reference: string, itemTitle: string): string {
  return `Case ${reference} has been cancelled after review: the item you returned for "${itemTitle}" was the correct one. Any dispute fee you paid on this case is being refunded and your account is no longer restricted by it.`;
}
