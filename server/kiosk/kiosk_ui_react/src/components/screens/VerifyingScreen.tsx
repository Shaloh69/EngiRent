import { StagedProgress } from "../loading/LoadingPrimitives";

/**
 * ML item verification — `ANIMATION-AND-LOADING-SPEC.md` §1.2.
 *
 * **Was a single rotating spinner** plus a hardcoded *"This takes about 15
 * seconds."* The spec is explicit that this is the wrong shape: the pipeline
 * has *named, ordered, genuinely distinct* stages, and *"a stepped indicator
 * that advances through real stage names beats a spinner, and it's honest,
 * because the stages exist."*
 *
 * **What is NOT done here, deliberately.** The stages are shown; none is
 * marked complete. Node sends one `verifying_item` status for the entire
 * pipeline, so which stage is running right now is genuinely unknown, and the
 * spec's instruction for exactly that case is *"Don't fake per-stage timing.
 * Advance on real signal, or show the current stage without a fake progress
 * bar underneath it."* Ticking these off on a timer would look better and be
 * a lie — the same trade this project already refused for the locker bar.
 *
 * `StagedProgress` takes a `currentStage` prop that nothing passes yet. When
 * the ML service reports stage progress, passing it lights this up with no
 * change to this file.
 */

/**
 * The real pipeline, in the real order (spec §1.2). These are the stages the
 * ML service actually runs — not invented reassurance copy — which is the
 * only reason showing them is honest.
 */
const ML_STAGES = [
  "Quality check",
  "Quick image match",
  "Shape and colour comparison",
  "Feature matching",
  "Structural similarity",
  "Deep visual model",
  "Serial number reading",
];

export function VerifyingScreen({ sub }: { sub: string }) {
  return (
    <div className="screen screen-verifying">
      <div className="verifying-wrap">
        <StagedProgress
          stages={ML_STAGES}
          label="Checking your item…"
          sub={sub}
        />
        <p className="verifying-warning">
          Please do not walk away yet — verification is still in progress.
        </p>
      </div>
    </div>
  );
}
