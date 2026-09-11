/**
 * D-58 verification — does `<MotionConfig reducedMotion="user">` actually stop
 * framer-motion on the kiosk?
 *
 *   cd server/kiosk/kiosk_ui_react && npm run dev
 *   node design/tools/probe-reduced-motion.mjs
 *
 * WHY A SCALE ANIMATION AND NOT A FADE. framer's `reducedMotion: "user"`
 * disables transform and layout animations and deliberately KEEPS opacity,
 * because opacity is not vestibular-triggering. Probing a crossfade would
 * therefore "fail" while the config was working perfectly. `LockersScreen`'s
 * bay cards animate `scale: 0.95 -> 1`, which is a transform, so they are the
 * honest target.
 *
 * WHY BOTH CONTEXTS. A settled transform reads as `matrix(1, 0, 0, 1, 0, 0)`
 * — identical to "never animated". So the no-preference run is the control:
 * it must show a NON-identity transform early, or the probe is measuring
 * nothing and a pass means nothing. This is the same control-experiment shape
 * the kiosk BEFORE captures needed.
 */
import { chromium } from "playwright";

// Parameterised so the same control-experiment can be pointed at any surface
// rather than copied per surface (which is how two implementations of one
// thing start). Defaults target the kiosk.
//   PROBE_URL=http://localhost:3000/ PROBE_W=1440 PROBE_H=900 PROBE_SELECTOR="div,span,section"
const URL =
  process.env.PROBE_URL ??
  `${process.env.KIOSK_URL ?? "http://localhost:5173"}/?demo=lockers&notetris=1`;
const SELECTOR = process.env.PROBE_SELECTOR ?? ".bay-door";
const VIEWPORT = {
  width: Number(process.env.PROBE_W ?? 1080),
  height: Number(process.env.PROBE_H ?? 1920),
};
const SAMPLES = Number(process.env.PROBE_SAMPLES ?? 8);
const EAGER = process.env.PROBE_EAGER === "1";
const EVERY_MS = Number(process.env.PROBE_EVERY_MS ?? 45);

async function run(reducedMotion) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT, reducedMotion });
  const page = await ctx.newPage();
  // EAGER mode exists because of the admin console. Its entrance animation is
  // 450ms, and on a Next dev server the gap between `domcontentloaded` and
  // this script's first sample is longer than that -- so the animation had
  // already finished and the control showed NO movement, which the probe
  // correctly reported as "measured nothing" rather than as a pass. Eager
  // mode installs a rAF recorder BEFORE navigation and reads it afterwards,
  // so the very first painted frames are captured.
  if (EAGER) {
    await page.addInitScript((sel) => {
      window.__probeFrames = [];
      const tick = () => {
        if (window.__probeFrames.length < 400) {
          window.__probeFrames.push(
            [...document.querySelectorAll(sel)].map(
              (el) => getComputedStyle(el).transform,
            ),
          );
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    }, SELECTOR);
  }

  await page.goto(URL, { waitUntil: EAGER ? "commit" : "domcontentloaded" });
  if (!EAGER) {
    await page.waitForSelector(SELECTOR, { timeout: 15000 }).catch(() => {});
  }

  // MEASURES MOVEMENT, NOT "IS IT TRANSFORMED".
  //
  // The first version of this counted elements carrying a non-identity
  // transform, and it reported a false FAIL on the website: 7 nodes sat at a
  // constant translateY(16px) under reduced motion. Those are `whileInView`
  // elements BELOW THE FOLD resting at their legitimate pre-trigger offset --
  // present in the control too, and never moving in either run. A static
  // offset is not an animation.
  //
  // So each sample records the transform of every matched element in DOM
  // order, and what counts is how many CHANGED since the previous sample.
  // Suppressed motion means zero changes; the control must show some, or the
  // probe measured nothing.
  const frames = [];
  if (EAGER) {
    await page.waitForTimeout(SAMPLES * EVERY_MS);
    const recorded = await page.evaluate(() => window.__probeFrames ?? []);
    frames.push(...recorded.filter((f) => f.length > 0));
  }
  for (let i = 0; EAGER ? false : i < SAMPLES; i++) {
    frames.push(
      await page.evaluate(
        (sel) =>
          [...document.querySelectorAll(sel)].map(
            (el) => getComputedStyle(el).transform,
          ),
        SELECTOR,
      ),
    );
    await page.waitForTimeout(EVERY_MS);
  }
  await browser.close();

  // THE CRITERION, and the third one this probe has had. The first two were
  // wrong in instructive ways and both are recorded in PROGRESS.md:
  //   1. "is it non-identity" -- false FAIL on the website, where `whileInView`
  //      elements below the fold rest at a legitimate static offset.
  //   2. "did it change at all" -- false FAIL on the admin, because
  //      `reducedMotion: "user"` is DEFINED to snap to the final value, so a
  //      suppressed element still changes exactly once, initial -> final.
  //
  // What actually separates the two is TWEENING. An animation walks through
  // intermediate values; a snap does not. So: count DISTINCT transforms per
  // element. Suppressed means at most 2 (its initial and its final);
  // animating means at least one element showed 3 or more.
  const perElement = new Map();
  for (const frame of frames) {
    frame.forEach((t, k) => {
      if (!perElement.has(k)) perElement.set(k, new Set());
      perElement.get(k).add(t);
    });
  }
  let maxDistinct = 0;
  let tweened = 0;
  const examples = [];
  for (const [, set] of perElement) {
    maxDistinct = Math.max(maxDistinct, set.size);
    if (set.size >= 3) {
      tweened++;
      if (examples.length < 3) examples.push([...set].slice(0, 4).join("  |  "));
    }
  }

  return {
    reducedMotion,
    elements: frames[0]?.length ?? 0,
    samples: frames.length,
    maxDistinctTransformsOnOneElement: maxDistinct,
    elementsThatTweened: tweened,
    anyNonIdentity: tweened > 0,
    examples,
  };
}

const control = await run("no-preference");
const test = await run("reduce");

console.log(JSON.stringify({ control, test }, null, 2));

const controlMoved = control.anyNonIdentity;
const testStill = !test.anyNonIdentity;

console.log(
  `\nCONTROL (no-preference) animated: ${controlMoved}` +
    `   <- must be true, or the probe proves nothing`,
);
console.log(`TEST    (reduce) held still:      ${testStill}`);
console.log(
  `\nRESULT: ${controlMoved && testStill ? "PASS" : "FAIL"} — ` +
    (controlMoved && testStill
      ? "transforms tween normally and only snap (no intermediates) under reduced motion."
      : !controlMoved
        ? "the control never moved, so this run measured nothing."
        : "reduced motion still TWEENED a transform."),
);
process.exit(controlMoved && testStill ? 0 : 1);
