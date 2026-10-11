import prisma from "../config/database";
import { recordEvent, withReference } from "./disputeEvents";
import { disputeMoney, feeCapFor } from "./disputeService";
import { formatWhen, peso } from "./disputeMessages";

/**
 * Ruling 13 — a formal letter for the ADMIN to submit to a UCLM office when a
 * case escalates (or on demand). The system writes it; a person signs and
 * submits it. Every generation and every submission is logged on the case.
 *
 * The content is a SNAPSHOT taken at generation (DisputeLetter.content), so the
 * letter that was submitted can always be shown exactly, even after the case
 * moves on. Rendered as printable HTML by the admin console (print / save as
 * PDF from the browser).
 *
 * Addressed by office and title only: the system does not know, and must not
 * invent, the names of the people holding those posts.
 */

export type Office = "SAO" | "ENGINEERING" | "GUIDANCE";

export const OFFICES: Record<Office, { addressee: string; office: string; request: string }> = {
  SAO: {
    addressee: "The Director",
    office: "Student Affairs Office",
    request:
      "We respectfully request that your office review this matter under the Student Code of Conduct and take the action it considers appropriate, including directing the student to return the item.",
  },
  ENGINEERING: {
    addressee: "The Dean",
    office: "Engineering Faculty",
    request:
      "We respectfully request that the Faculty be informed of this matter concerning one of its students, and that the student be directed to return the item.",
  },
  GUIDANCE: {
    addressee: "The Head",
    office: "Guidance Office",
    request:
      "We respectfully request that your office reach out to the student, and if appropriate their parent or guardian, to help resolve this matter.",
  },
};

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

const CONTACT_TYPES = new Set(["CONTACT"]);
const TIMELINE_TYPES = new Set([
  "OPENED",
  "PROMPT",
  "REMINDER",
  "WRONG_ITEM_PLACED",
  "WRONG_ITEM_COLLECTED",
  "PAYMENT_SUBMITTED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_REJECTED",
  "CORRECT_ITEM_PLACED",
  "DEADLINE_CHANGED",
  "ESCALATED",
  "REVIEW_REQUESTED",
  "LETTER_SUBMITTED",
]);

export async function buildLetterContent(disputeId: string, office: Office, signatoryId: string | null): Promise<LetterContent> {
  const d = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      rental: {
        include: {
          item: true,
          renter: true,
          owner: { select: { firstName: true, lastName: true, studentId: true } },
          returnLocker: { select: { lockerNumber: true } },
          verification: { select: { kioskImages: true, createdAt: true } },
        },
      },
    },
  });
  if (!d) throw new Error("Case not found");
  const r = d.rental;
  const s = r.renter;
  const o = OFFICES[office];
  const money = await disputeMoney(d);
  const cap = await feeCapFor(d);
  const signer = signatoryId
    ? await prisma.user.findUnique({ where: { id: signatoryId }, select: { firstName: true, lastName: true } })
    : null;

  const facts: Array<[string, string]> = [
    ["Case reference", d.referenceNo],
    ["Student", `${s.firstName} ${s.lastName}`],
    ["Student ID", s.studentId],
    ["Email", s.email],
    ["Phone", s.phoneNumber],
    ["Parent or guardian", s.parentName ? `${s.parentName}${s.parentContact ? `, ${s.parentContact}` : ""}` : "not on record"],
    ["Item rented", r.item.title],
    ["Item owner", `${r.owner.firstName} ${r.owner.lastName} (${r.owner.studentId})`],
    ["Rental period", `${formatWhen(r.startDate)} to ${formatWhen(r.endDate)}`],
    ["Rental price / security deposit", `${peso(r.totalPrice)} / ${peso(r.securityDeposit)}`],
    ["Item's replacement value", r.item.replacementValue != null ? peso(r.item.replacementValue) : "not stated by the owner"],
    ["Return attempted", `${formatWhen(r.returnedAt)}${r.returnLocker ? `, locker ${r.returnLocker.lockerNumber}` : ""}`],
    ["What the AI saw", d.aiSummary ? d.aiSummary.split("\n")[0] : "no AI verdict on record"],
    ["Admin decision", `Rejected as the wrong item on ${formatWhen(d.openedAt)} after reviewing the locker photos`],
    ["Offence", d.offense >= 2 ? `repeat (offence ${d.offense})` : "first"],
    ["Deadline given", formatWhen(d.deadlineAt)],
  ];

  // Only what really reached someone: an email the server could not send is
  // left out, and the cover paragraph names only the channels that worked.
  const delivered = (e: { outcome: string | null }) => !(e.outcome ?? "").startsWith("NOT_SENT");
  const emailedRenter = d.events.some(
    (e) => e.audience === "RENTER" && e.channel === "EMAIL" && (e.outcome ?? "") === "SENT",
  );
  const timeline = d.events
    .filter((e) => (TIMELINE_TYPES.has(e.type) || (e.type === "MESSAGE" && e.audience === "RENTER")) && delivered(e))
    .map((e) => ({
      at: formatWhen(e.createdAt),
      what:
        `${e.type.replace(/_/g, " ").toLowerCase()}` +
        (e.audience ? ` (to ${e.audience.toLowerCase()}${e.channel ? `, ${e.channel.toLowerCase().replace("_", "-")}` : ""})` : "") +
        (e.title ? `: ${e.title}` : ""),
    }));

  const contacts = d.events
    .filter((e) => CONTACT_TYPES.has(e.type))
    .map((e) => ({
      at: formatWhen(e.createdAt),
      who: (e.audience ?? "").toLowerCase(),
      channel: (e.channel ?? "").toLowerCase(),
      outcome: (e.outcome ?? "").toLowerCase().replace(/_/g, " "),
      note: e.message ?? "",
    }));

  const kioskImages = (r.verification?.kioskImages as string[] | null) ?? [];
  const listingImages = (r.item.images as string[] | null) ?? [];
  const attachments = [
    ...listingImages.map((_, i) => `Listing photo ${i + 1} of the ${r.item.title}`),
    ...kioskImages.map((_, i) => `Locker photo ${i + 1} of the item returned (${formatWhen(r.verification?.createdAt ?? null)})`),
  ];

  return {
    subject: `Report of an unresolved equipment-rental dispute (${d.referenceNo})`,
    addressee: [o.addressee, o.office, "University of Cebu Lapu-Lapu and Mandaue (UCLM)"],
    date: formatWhen(new Date()).split(",").slice(0, 2).join(","),
    salutation: `Dear ${o.addressee.replace(/^The /, "")}:`,
    paragraphs: [
      `EngiRent Hub is a peer-to-peer equipment rental service for engineering students, operated in partnership with the University of Cebu Lapu-Lapu and Mandaue (UCLM). Items change hands through an unattended locker kiosk, and every return is checked against the owner's listing.`,
      `We write to report that ${s.firstName} ${s.lastName} (student ID ${s.studentId}) returned an item that is not the one they rented. Our system flagged the return and an administrator confirmed it after reviewing the locker photos. The student was told immediately${emailedRenter ? ", in the EngiRent app and by email," : " in the EngiRent app"} what happened, what they owe, and how to resolve it, and was given until ${formatWhen(d.deadlineAt)}. As of this letter, the correct item has not been returned.`,
      `The facts of the case, the record of every notification sent and every contact attempt made, and the amount outstanding are set out below.`,
    ],
    facts,
    timeline,
    contacts,
    outstanding:
      `${peso(money.owed)} in dispute fees outstanding (fees accrued ${peso(money.statement.accrued)}, paid ${peso(money.paid)}). ` +
      (r.item.replacementValue != null
        ? `If the item is not recovered, the owner may claim its full value (${peso(r.item.replacementValue)}).`
        : `If the item is not recovered, the owner may claim its full value (not yet stated by the owner; the fees are capped at ${peso(cap.cap)} meanwhile).`),
    request: o.request,
    privacy:
      "This letter contains personal information shared under the EngiRent Terms the student accepted, which state that their guardian and the school may be contacted in a dispute, in accordance with the Data Privacy Act of 2012 (Republic Act No. 10173). Please use it for this matter only.",
    attachments,
    signatory: {
      name: signer ? `${signer.firstName} ${signer.lastName}` : "________________________",
      title: "Administrator",
      organisation: "EngiRent Hub",
    },
  };
}

export async function generateLetter(disputeId: string, office: Office, adminId: string | null) {
  const content = await buildLetterContent(disputeId, office, adminId);
  const letter = await withReference("LTR", (referenceNo) =>
    prisma.disputeLetter.create({
      data: { disputeId, office, referenceNo, content: content as never, generatedById: adminId },
    }),
  );
  await recordEvent(disputeId, {
    type: "LETTER_GENERATED",
    actorRole: adminId ? "ADMIN" : "SYSTEM",
    actorId: adminId,
    audience: office,
    channel: "LETTER",
    title: content.subject,
    message: `Letter ${letter.referenceNo} to the ${OFFICES[office].office} generated${adminId ? "" : " automatically on escalation"}.`,
  });
  return letter;
}

export async function markLetterSubmitted(letterId: string, adminId: string, note: string | null) {
  const letter = await prisma.disputeLetter.update({
    where: { id: letterId },
    data: { submittedAt: new Date(), submittedById: adminId, submissionNote: note },
  });
  await recordEvent(letter.disputeId, {
    type: "LETTER_SUBMITTED",
    actorRole: "ADMIN",
    actorId: adminId,
    audience: letter.office as never,
    channel: "LETTER",
    message: `Letter ${letter.referenceNo} submitted to the ${OFFICES[letter.office as Office].office}.${note ? ` ${note}` : ""}`,
  });
  return letter;
}
