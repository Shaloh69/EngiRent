import crypto from "crypto";
import type { PaymentEnv } from "./config";

/**
 * PayMongo webhook signature (docs: "Securing a webhook"):
 *   Paymongo-Signature: t=<timestamp>,te=<test-mode sig>,li=<live-mode sig>
 *   sig = hex(HMAC-SHA256(webhookSecret, `${t}.${rawBody}`))
 * The sandbox gateway accepts ONLY `te`, the live gateway ONLY `li`: an event
 * signed for the other mode is rejected, never "whichever field is present"
 * (the main API's old verifier took `te ?? li`).
 *
 * No timestamp window is enforced: PayMongo retries a delivery for ~2.25 h,
 * and a replayed event is harmless because the main API re-checks the payment
 * with PayMongo before marking anything paid (SPEC §6).
 */
export function parseSignatureHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function hmacHex(secret: string, message: string): string {
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

/** Constant-time comparison of two hex strings; false on any length or format mismatch. */
export function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const ab = Buffer.from(a.toLowerCase(), "utf8");
  const bb = Buffer.from(b.toLowerCase(), "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function verifyPaymongoSignature(rawBody: string, header: string | undefined, secret: string, mode: PaymentEnv): boolean {
  if (!secret || !header) return false;
  const parts = parseSignatureHeader(header);
  const t = parts.t;
  const sig = mode === "sandbox" ? parts.te : parts.li;
  if (!t || !sig) return false;
  return safeEqualHex(hmacHex(secret, `${t}.${rawBody}`), sig);
}

/**
 * Gateway -> main API: the forwarded event is signed with the shared
 * GATEWAY_TOKEN over `${timestampMs}.${body}`. The main API refuses anything
 * older than 5 minutes (replay) and still re-checks with PayMongo.
 */
export function signForward(token: string, body: string, timestampMs: number): string {
  return hmacHex(token, `${timestampMs}.${body}`);
}
