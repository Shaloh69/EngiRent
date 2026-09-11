import type { MlVerificationResult } from "./mlVerificationService";

/**
 * D-65 — "no evidence" and "evidence of no match" were the same database row.
 *
 * `mlVerificationService` already distinguished the two (it returns
 * `unavailable: true` + `unavailableReason` when the reference or kiosk images
 * cannot be downloaded, with a unit test for it) and then the flag was thrown
 * away: nothing read it and `Verification` had no column for it. So a
 * `confidenceScore: 0, decision: PENDING, status: MANUAL_REVIEW` row could mean
 * the ML service was unreachable, the images could not be fetched, or the items
 * genuinely did not match — and A-3's two zero-score rows are uninterpretable
 * for exactly that reason.
 *
 * This module is the one place those fields are produced, so a verification
 * write cannot quietly omit them. Nothing here reaches the GPIO layer or the
 * face-verification trust architecture.
 */

/** `unavailableReason` for the third case the service cannot see: it never ran. */
export const ML_UNREACHABLE = "ml_unreachable";

/**
 * The synthetic result used when the call to the ML service itself threw.
 *
 * `mlVerificationService` marks `reference_images_unavailable` /
 * `kiosk_images_unavailable` from inside the pipeline; it cannot mark this one,
 * because the throw happens before it can return. Fails closed to PENDING — a
 * human must look, and we must never auto-approve on missing evidence.
 */
export function mlUnreachableResult(): MlVerificationResult {
  return {
    decision: "PENDING",
    confidence: 0,
    method_scores: {},
    ocr: null,
    unavailable: true,
    unavailableReason: ML_UNREACHABLE,
  };
}

export interface VerificationEvidenceFields {
  unavailable: boolean;
  unavailableReason: string | null;
}

/**
 * The two D-65 columns, derived from whatever the ML layer returned.
 *
 * A scored comparison from the ML service carries neither field, so it lands as
 * `false / null` — evidence exists and the score means what it says. Anything
 * the pipeline marked unavailable lands as `true` plus the reason, and must be
 * excluded from any calibration set (E4.5c).
 */
export function verificationEvidenceFields(
  result: Pick<MlVerificationResult, "unavailable" | "unavailableReason">,
): VerificationEvidenceFields {
  return {
    unavailable: result.unavailable === true,
    unavailableReason: result.unavailable === true
      ? (result.unavailableReason ?? null)
      : null,
  };
}
