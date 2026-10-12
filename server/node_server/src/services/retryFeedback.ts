/**
 * What the phone is told when the quick check asks for a retry (user request
 * 2026-10-12): the AI's own plain sentence and the locker photo(s), so the person
 * at the open locker can see WHY ("More than one object is in the locker") instead
 * of a generic "reposition the item".
 *
 * One pure helper for both `deposit:retry` and `return:retry`, so the two emits
 * cannot drift. It is only ever sent to the user who placed the item (their own
 * socket room); the photos are the short-lived signed URLs the kiosk upload returned.
 */

export const MAX_RETRY_IMAGES = 3;
const MAX_REASON_CHARS = 240;

export interface RetryFeedbackSource {
  message?: string | null;
  reposition?: boolean | null;
}

export interface RetryFeedback {
  /** The AI's own sentence, or null when it gave none (the phone then shows its generic line). */
  reason: string | null;
  /** True when the AI asked for the item to be moved (a placement problem), false for a weak match. */
  reposition: boolean;
  /** Up to MAX_RETRY_IMAGES http(s) URLs of what the locker camera saw. */
  imageUrls: string[];
}

export function buildRetryFeedback(source: RetryFeedbackSource, imageUrls: unknown): RetryFeedback {
  const raw = typeof source.message === "string" ? source.message.replace(/\s+/g, " ").trim() : "";
  const reason = raw ? (raw.length > MAX_REASON_CHARS ? `${raw.slice(0, MAX_REASON_CHARS - 1).trimEnd()}…` : raw) : null;
  const urls = Array.isArray(imageUrls)
    ? imageUrls.filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u)).slice(0, MAX_RETRY_IMAGES)
    : [];
  return { reason, reposition: source.reposition === true, imageUrls: urls };
}
