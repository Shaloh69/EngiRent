import axios from "axios";
import env from "../config/env";
import logger from "../utils/logger";
import { publicItemUrl, toRelativeMediaPath } from "./storageService";

/**
 * Item-comparison ML calls, extracted from `index.ts` on 2026-09-06.
 *
 * WHY THIS FILE EXISTS. The logic below is unchanged — this is a move, not a
 * rewrite. It lived at module scope in `index.ts`, which starts an HTTP server
 * and a socket.io server on import, so importing it from a test booted the
 * whole application. That made D-18 — the defect where a failed reference
 * download silently returned a bare `PENDING` indistinguishable from a genuine
 * 60-84 manual-review verdict — **untestable**, which is why it was still
 * uncovered while every other fixed defect had a regression test.
 *
 * Nothing here reaches the GPIO layer or the face-verification trust
 * architecture. Item comparison and identity verification are different
 * systems that happen to share an ML service.
 */

export interface MlVerificationResult {
  decision: string;
  confidence: number;
  method_scores: Record<string, number>;
  ocr: unknown;
  /** True when the pipeline never ran (references unavailable) — see D-18. */
  unavailable?: boolean;
  unavailableReason?: string;
  /** D-87: the time budget forced stages to be skipped. */
  degraded?: boolean;
  skipped_stages?: string[];
  elapsed_seconds?: number;
  /** D-87b: which tier answered — "fast" or "full". */
  mode?: string;
  /** Human-readable verdict from the ML service ("Part of the item is outside the camera's view…"). */
  message?: string;
  /** D-114: the v2 pipeline's reasoning. All absent on a v1 answer. */
  pipeline?: string;
  placement?: Record<string, unknown> | null;
  reposition?: boolean;
  quality_blocked?: boolean;
  evidence?: Record<string, unknown> | null;
  stage_seconds?: Record<string, number> | null;
}

/**
 * D-87b — TWO TIERS.
 *
 * `fast` is the check a student is standing at an open locker waiting for. It
 * runs what fits in ~25s and says so when it had to skip something.
 *
 * `full` is the re-run for a row that is already headed to a human. Nobody is
 * waiting, so every stage runs; it can take minutes. It never drives the
 * rental — it only puts better evidence in front of the reviewer.
 */
export type MlVerificationMode = "fast" | "full";

/**
 * Axios needs its own ceiling or a wedged ML service hangs the socket handler
 * that called it — which is exactly how a bay ended up reserved with an item
 * inside on 2026-09-18. Give each tier headroom over the service's own budget
 * so the timeout only ever fires when the service has genuinely stopped
 * answering, not when it is merely being slow on purpose.
 */
/**
 * D-87c (2026-09-18, found by the first real deposit). These were 45s/960s, and
 * the 45s **fired on the very first physical test**: the row recorded
 * `ml_unreachable` / "timeout of 45000ms exceeded", so the fast tier
 * contributed nothing and the reviewer got a 0.0% row with no evidence.
 *
 * The 45s was chosen as "service budget 25s + headroom", which was wrong about
 * how the budget works. `verify_time_budget_seconds` is checked BETWEEN stages,
 * not inside them — so one long stage sails straight past it. Measured fast
 * runs: 25.1s, 29.0s, 36.8s on my own probe images, and over 45s on real kiosk
 * photos. The budget bounds when the pipeline STOPS STARTING new work; it does
 * not bound the wall clock.
 *
 * So a client timeout tuned close to the budget defeats the entire "the service
 * always answers" design — it turns a slow-but-real verdict into no verdict.
 * These are now backstops against a genuinely wedged process, nothing more, and
 * are deliberately far above any observed run. The thing that keeps the student
 * at the locker from waiting forever is the service's own budget, not this.
 */
const REQUEST_TIMEOUT_MS: Record<MlVerificationMode, number> = {
  fast: 120_000,
  full: 960_000,
};

/**
 * Item media reaches this path straight from Prisma, so it never passes through
 * `mediaUrlRewriter` (which only rewrites outgoing res.json bodies). Resolve it
 * here instead.
 *
 * This deliberately normalises *any* stored form back to a relative path and
 * then rebuilds it against the **current** `API_PUBLIC_URL`. That way legacy
 * rows still holding an absolute URL with a dead Cloudflare hostname are healed
 * on read, rather than needing every historical row migrated before item
 * verification starts working again (D-17/D-18).
 */
export function resolveMediaUrl(stored: string): string {
  const rel = toRelativeMediaPath(stored);
  return rel.startsWith("items/") ? publicItemUrl(rel) : stored;
}

export async function downloadBlob(rawUrl: string): Promise<Blob | null> {
  const url = resolveMediaUrl(rawUrl);
  try {
    const r = await axios.get(url, { responseType: "arraybuffer" });
    return new Blob([r.data as ArrayBuffer], { type: "image/jpeg" });
  } catch {
    // Deliberately logged at warn with the resolved URL — when this fires for
    // every reference image the caller now escalates to logger.error and marks
    // the outcome `unavailable`, so it can no longer masquerade as a real
    // PENDING verdict.
    logger.warn(`Could not download image: ${url}`);
    return null;
  }
}

export async function runMlVerification(
  originalUrls: string[],
  kioskUrls: string[],
  attemptNumber: number,
  mlFeatures: unknown,
  mode: MlVerificationMode = "fast",
): Promise<MlVerificationResult> {
  const [origBlobs, kioskBlobs] = await Promise.all([
    Promise.all(originalUrls.map(downloadBlob)),
    Promise.all(kioskUrls.map(downloadBlob)),
  ]);

  const validOrig = origBlobs.filter((b): b is Blob => b !== null);
  const validKiosk = kioskBlobs.filter((b): b is Blob => b !== null);

  // D-18: this used to return a bare `PENDING / confidence 0`, which is
  // indistinguishable from a genuine 60-84 manual-review outcome. When every
  // reference download failed — as it did for every item after a Cloudflare
  // tunnel rotation, because image URLs had the old hostname baked in (D-17) —
  // the ML service was never called at all and *every* deposit and return was
  // silently routed to a human, with a confidence score that looked real and
  // nothing but a `logger.warn` to show for it.
  //
  // Still fail closed to PENDING (a human must look; we must never auto-approve
  // on missing evidence), but say so loudly and mark the outcome so the reason
  // survives into the record and the admin queue.
  if (validOrig.length === 0 || validKiosk.length === 0) {
    logger.error(
      "ML verification skipped — could not download reference images. " +
        `original: ${validOrig.length}/${originalUrls.length}, ` +
        `kiosk: ${validKiosk.length}/${kioskUrls.length}. ` +
        "This is an infrastructure failure, NOT a real comparison — check that " +
        "stored media paths still resolve (see D-17).",
    );
    return {
      decision: "PENDING",
      confidence: 0,
      method_scores: { error: 1 },
      ocr: null,
      unavailable: true,
      unavailableReason:
        validOrig.length === 0
          ? "reference_images_unavailable"
          : "kiosk_images_unavailable",
    };
  }

  const formData = new FormData();
  validOrig.forEach((b, i) =>
    formData.append("original_images", b, `original_${i}.jpg`),
  );
  validKiosk.forEach((b, i) =>
    formData.append("kiosk_images", b, `kiosk_${i}.jpg`),
  );
  formData.append("attempt_number", String(attemptNumber));
  formData.append("mode", mode);
  if (mlFeatures)
    formData.append("reference_features", JSON.stringify(mlFeatures));

  const resp = await axios.post(
    `${env.ML_SERVICE_URL}/api/v1/verify`,
    formData,
    {
      timeout: REQUEST_TIMEOUT_MS[mode],
      headers: {
        ...(env.ML_SERVICE_API_KEY && { "X-API-Key": env.ML_SERVICE_API_KEY }),
      },
    },
  );

  return resp.data as MlVerificationResult;
}
