import nodemailer, { Transporter } from "nodemailer";
import env from "../config/env";
import logger from "./logger";

let _transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) return null;
  if (_transporter) return _transporter;

  _transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: parseInt(env.SMTP_PORT),
    secure: parseInt(env.SMTP_PORT) === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });

  return _transporter;
}

const FROM = env.SMTP_FROM ?? env.SMTP_USER ?? "noreply@engirent.app";

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<void> {
  const t = getTransporter();
  if (!t) return; // email disabled — fail silently

  try {
    await t.sendMail({ from: FROM, ...opts });
    logger.info(`Email sent to ${opts.to}: "${opts.subject}"`);
  } catch (err) {
    logger.warn(`Email send failed to ${opts.to}: ${(err as Error).message}`);
  }
}

// ── Pre-built templates ────────────────────────────────────────────────────

export async function sendBookingConfirmed(
  to: string,
  opts: {
    firstName: string;
    itemTitle: string;
    startDate: string;
    endDate: string;
    totalPrice: number;
    rentalId: string;
  },
): Promise<void> {
  await sendEmail({
    to,
    subject: `Booking Confirmed – ${opts.itemTitle}`,
    html: `<h2>Hi ${opts.firstName},</h2>
<p>Your rental request for <strong>${opts.itemTitle}</strong> has been confirmed.</p>
<ul>
  <li>Rental ID: ${opts.rentalId}</li>
  <li>Period: ${opts.startDate} → ${opts.endDate}</li>
  <li>Total: ₱${opts.totalPrice.toFixed(2)}</li>
</ul>
<p>Please proceed to the kiosk to deposit the item after payment.</p>`,
  });
}

export async function sendItemReadyForClaim(
  to: string,
  opts: {
    firstName: string;
    itemTitle: string;
    rentalId: string;
  },
): Promise<void> {
  await sendEmail({
    to,
    subject: `Your item is ready – ${opts.itemTitle}`,
    html: `<h2>Hi ${opts.firstName},</h2>
<p>The item <strong>${opts.itemTitle}</strong> has been deposited and is ready for pickup at the kiosk.</p>
<p>Rental ID: ${opts.rentalId}</p>
<p>Please visit the kiosk and scan your QR code to claim it.</p>`,
  });
}

export async function sendReturnReminder(
  to: string,
  opts: {
    firstName: string;
    itemTitle: string;
    dueDate: string;
    rentalId: string;
  },
): Promise<void> {
  await sendEmail({
    to,
    subject: `Return Reminder – ${opts.itemTitle}`,
    html: `<h2>Hi ${opts.firstName},</h2>
<p>This is a reminder that <strong>${opts.itemTitle}</strong> is due for return on <strong>${opts.dueDate}</strong>.</p>
<p>Rental ID: ${opts.rentalId}</p>
<p>Please return the item on time to avoid late fees.</p>`,
  });
}

export async function sendReturnOverdue(
  to: string,
  opts: {
    firstName: string;
    itemTitle: string;
    dueDate: string;
    daysLate: number;
    lateFee: number;
    rentalId: string;
  },
): Promise<void> {
  await sendEmail({
    to,
    subject: `OVERDUE – ${opts.itemTitle}`,
    html: `<h2>Hi ${opts.firstName},</h2>
<p><strong>${opts.itemTitle}</strong> was due on ${opts.dueDate} and is now <strong>${opts.daysLate} day(s) late</strong>.</p>
<p>A late fee of <strong>₱${opts.lateFee.toFixed(2)}</strong> has been applied.</p>
<p>Please return the item immediately at the kiosk. Rental ID: ${opts.rentalId}</p>`,
  });
}

export async function sendRentalCompleted(
  to: string,
  opts: {
    firstName: string;
    itemTitle: string;
    rentalId: string;
  },
): Promise<void> {
  await sendEmail({
    to,
    subject: `Rental Completed – ${opts.itemTitle}`,
    html: `<h2>Hi ${opts.firstName},</h2>
<p>Your rental of <strong>${opts.itemTitle}</strong> has been completed successfully.</p>
<p>Rental ID: ${opts.rentalId}</p>
<p>Security deposit refund will be processed within 3–5 business days.</p>`,
  });
}

export async function sendVerificationFailed(
  to: string,
  opts: {
    firstName: string;
    itemTitle: string;
    rentalId: string;
    reason: "deposit" | "return";
  },
): Promise<void> {
  const action = opts.reason === "deposit" ? "deposit" : "return";
  await sendEmail({
    to,
    subject: `Verification Failed – ${opts.itemTitle}`,
    html: `<h2>Hi ${opts.firstName},</h2>
<p>The AI verification for your ${action} of <strong>${opts.itemTitle}</strong> failed.</p>
<p>Rental ID: ${opts.rentalId}</p>
<p>An admin will review the images and contact you shortly.</p>`,
  });
}

export async function sendPaymentReceived(
  to: string,
  opts: {
    firstName: string;
    amount: number;
    itemTitle: string;
    rentalId: string;
  },
): Promise<void> {
  await sendEmail({
    to,
    subject: `Payment Received – ₱${opts.amount.toFixed(2)}`,
    html: `<h2>Hi ${opts.firstName},</h2>
<p>We received your payment of <strong>₱${opts.amount.toFixed(2)}</strong> for <strong>${opts.itemTitle}</strong>.</p>
<p>Rental ID: ${opts.rentalId}</p>`,
  });
}
