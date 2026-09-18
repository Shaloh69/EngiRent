/**
 * D-89 — when a quick check's verdict is allowed to act on its own.
 *
 * FOUND IN THE SECOND PHYSICAL TEST (2026-09-19). A correct item — a yellow
 * "GLUE GUN 60W", unmistakably the one in its listing photos — was put in bay 1
 * and came back RETRY four times in a row. Every RETRY re-opened the door and
 * told the owner to reposition it. Scored in full with nothing skipped, the
 * captures came out at ~53 (below the 60 RETRY line) no matter which listing
 * photo they were compared with. Per stage: SSIM 17, traditional 52, pHash 49,
 * SIFT 63, deep learning 70.
 *
 * The cause is not placement. The listing photos are on wrinkled beige fabric
 * in soft light; the locker is flat white metal with a red edge under a harsh
 * flash. SSIM, pHash and the colour/texture features compare the whole scene,
 * so they mostly measure how different the locker looks from the owner's
 * bedsheet. Repositioning cannot change the background, the lighting, or which
 * side the listing photographed, so the advice "reposition and try again" was
 * advice that could never work.
 *
 * And the loop had an ending that was worse than the loop: the ML service
 * returns RETRY up to attempt 10 and then REJECTED, and a REJECTED deposit
 * CANCELS the rental and drops the item back to the owner. So a correct item
 * would have cost the owner ten door cycles and the renter their paid rental,
 * and at no point did any of it reach a person — a RETRY creates no
 * verification row, so the admin queue never showed a thing.
 *
 * That contradicts the user's standing ruling (2026-09-18): "if the score is
 * below 85 regardless of day it will always need admin approval". This module
 * is that ruling, applied to the one path that was ignoring it.
 */

/**
 * How many attempts a quick check may ask for before a person looks instead.
 *
 * 2 = the first try plus ONE retry. The retry is kept because it is genuinely
 * useful for the cases it was built for — an item half out of the camera's
 * view, a door closed on a strap, a capture that fails the quality gate.
 * Beyond one retry the evidence from the test is that repeating the same photo
 * in the same locker produces the same score, so further retries only cost the
 * person standing there another door cycle.
 */
export const MAX_ATTEMPTS_BEFORE_REVIEW = 2;

export interface VerdictOutcome {
  /** The verdict the handler should act on. */
  decision: string;
  /** True when the quick check's own verdict was overridden. */
  escalated: boolean;
  /** Human-readable why, stored on the verification row for the reviewer. */
  note: string | null;
}

/**
 * For a DEPOSIT.
 *
 *  - REJECTED is never acted on automatically. It used to cancel a paid rental
 *    and move the item with the actuator on the strength of a quick check that
 *    scores a correct glue gun at 53. A person decides, with the photographs in
 *    front of them (admin Review), and can still reject from there.
 *  - RETRY is honoured for the first attempt only; after that it goes to a
 *    person rather than re-opening the door again.
 *  - APPROVED and PENDING pass through unchanged.
 */
export function depositVerdict(decision: string, attemptNumber: number): VerdictOutcome {
  if (decision === "REJECTED") {
    return {
      decision: "PENDING",
      escalated: true,
      note:
        "Quick check scored this as a mismatch. Not acted on automatically — a " +
        "deposit is only rejected by a person looking at the photographs.",
    };
  }
  if (decision === "RETRY" && attemptNumber >= MAX_ATTEMPTS_BEFORE_REVIEW) {
    return {
      decision: "PENDING",
      escalated: true,
      note:
        `Quick check asked for a retry on attempt ${attemptNumber}. Sent for review ` +
        `instead of re-opening the door again: a low score that survives a ` +
        `reposition is almost always the locker's background and lighting, which ` +
        `repositioning cannot change.`,
    };
  }
  return { decision, escalated: false, note: null };
}

/**
 * For a RETURN.
 *
 * Same retry cap. REJECTED is left alone here, deliberately: on a return it
 * already goes to a person — the rental becomes DISPUTED and lands in the
 * disputes queue — so it never acted on its own in the first place.
 */
export function returnVerdict(decision: string, attemptNumber: number): VerdictOutcome {
  if (decision === "RETRY" && attemptNumber >= MAX_ATTEMPTS_BEFORE_REVIEW) {
    return {
      decision: "PENDING",
      escalated: true,
      note:
        `Quick check asked for a retry on attempt ${attemptNumber} of a return. Sent ` +
        `for review instead of re-opening the door again.`,
    };
  }
  return { decision, escalated: false, note: null };
}
