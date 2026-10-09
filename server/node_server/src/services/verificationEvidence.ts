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

/** E5.3 — why a long-lead deposit carries no fast-lane score. */
export const LONG_LEAD_FULL_CHECK = "long_lead_full_check_queued";

/**
 * E5.3 — the placeholder verdict for a deposit whose pick-up is days away.
 *
 * Such a deposit is decided by the FULL verification run, not the fast one, so
 * no fast check is performed at all and there is deliberately no score here.
 *
 * Why not simply run the full check inline? Because the OWNER is standing at
 * an open locker during a deposit. The full pipeline takes 30-95s, and making
 * someone wait that long in a public corridor is precisely the failure D-87
 * was about. Running the fast check anyway and then discarding it would also
 * be wrong: it is a second job for a single-process ML service whose answer
 * nobody is going to use.
 *
 * So the deposit completes immediately, the item is in, and the full run
 * decides seconds later — auto-approving at >= 85 (deepReviewQueue) or going
 * to a human. `unavailable` is set for the same reason as the unreachable
 * case: this row carries NO comparison evidence, and D-65 exists so a zero
 * score can never be mistaken for a real one. It must be excluded from any
 * threshold calibration set.
 */
export function longLeadPendingResult(): MlVerificationResult {
  return {
    decision: "PENDING",
    confidence: 0,
    method_scores: {},
    ocr: null,
    unavailable: true,
    unavailableReason: LONG_LEAD_FULL_CHECK,
  };
}

export interface VerificationEvidenceFields {
  unavailable: boolean;
  unavailableReason: string | null;
  /** D-114 — undefined (column left null) unless a v2 answer carried reasoning. */
  mlEvidence?: never;
}

/**
 * D-114. What the AI thought, in a shape the admin console can render.
 *
 * Only a v2 answer carries any (`pipeline: "v2"`); a v1 answer, a synthetic
 * "ML unreachable" result and a "long-lead pending" result return null, so the
 * column never holds something that looks like reasoning and is not. Small by
 * construction: a placement verdict, a dozen numbers and the stage times.
 */
export function buildMlEvidence(
  result: Pick<
    MlVerificationResult,
    | "pipeline"
    | "mode"
    | "message"
    | "placement"
    | "reposition"
    | "quality_blocked"
    | "evidence"
    | "stage_seconds"
    | "elapsed_seconds"
    | "confidence"
    | "decision"
  >,
): Record<string, unknown> | null {
  if (result.pipeline !== "v2") return null;
  return {
    pipeline: result.pipeline,
    mode: result.mode ?? null,
    decision: result.decision,
    confidence: result.confidence,
    message: result.message ?? null,
    placement: result.placement ?? null,
    reposition: result.reposition === true,
    qualityBlocked: result.quality_blocked === true,
    evidence: result.evidence ?? null,
    stageSeconds: result.stage_seconds ?? null,
    elapsedSeconds: result.elapsed_seconds ?? null,
  };
}

/**
 * The D-65 columns plus the D-114 reasoning, derived from whatever the ML layer
 * returned.
 *
 * A scored comparison from the ML service carries neither D-65 field, so it
 * lands as `false / null` — evidence exists and the score means what it says.
 * Anything the pipeline marked unavailable lands as `true` plus the reason, and
 * must be excluded from any calibration set (E4.5c).
 */
export function verificationEvidenceFields(
  result: Pick<MlVerificationResult, "unavailable" | "unavailableReason"> &
    Partial<Parameters<typeof buildMlEvidence>[0]>,
): VerificationEvidenceFields {
  const evidence = buildMlEvidence({
    confidence: 0,
    decision: "",
    ...result,
  });
  return {
    unavailable: result.unavailable === true,
    unavailableReason: result.unavailable === true
      ? (result.unavailableReason ?? null)
      : null,
    // `as never`: Prisma's Json input type rejects a plain Record under strict
    // typing; the same cast the neighbouring Json writes use.
    mlEvidence: (evidence ?? undefined) as never,
  };
}
