import { useEffect, useRef, useState } from "react";
import "./loading.css";

/**
 * E3.2 — the three loading primitives.
 *
 * `ANIMATION-AND-LOADING-SPEC.md` §1 is emphatic that this is three
 * primitives and not one: the system has three genuinely long operations,
 * each with a different *shape*, and "a single generic spinner across all
 * three would be the wrong answer three times".
 *
 *   §1.1 locker actuation   → DETERMINATE   (duration is genuinely known)
 *   §1.2 ML verification    → STAGED        (stages are genuinely named)
 *   §1.3 face round-trip    → INDETERMINATE (neither is known — say so)
 *
 * The discipline that makes these honest is negative: a primitive may only
 * claim what it actually knows. `DeterminateProgress` REQUIRES a real
 * duration and refuses to invent one; `StagedProgress` renders no position
 * unless a real stage signal is passed; `IndeterminateProgress` shows no
 * percentage at all, because it has none.
 *
 * Reduced motion is handled per primitive rather than by one blanket rule,
 * because "freeze to the end state" — correct for a transition — would make
 * a progress bar assert that a 15-second door had finished. See each one.
 */

/** Matches the OS/browser setting, and keeps matching if it changes. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

// ── §1.1 DETERMINATE ────────────────────────────────────────────────────────

export interface DeterminateProgressProps {
  /**
   * The REAL duration, in seconds, of the operation being waited on.
   *
   * There is deliberately no default. The one thing the spec bans outright is
   * a canned animation over a hardware wait — "a canned 3-second 'opening'
   * animation on a locker that takes 22 seconds is a lie the user will
   * catch" — so a caller that cannot supply a real number must use
   * `IndeterminateProgress` instead of guessing one.
   */
  durationSeconds: number;
  label: string;
  /** Optional second line, e.g. which locker. */
  sub?: string;
}

/**
 * A real determinate bar, driven by a real duration.
 *
 * Progress is computed from wall-clock elapsed time rather than from a CSS
 * transition, for two reasons. It stays correct if the Pi's compositor drops
 * frames mid-animation (this runs on a Raspberry Pi driving a 1080x1920
 * panel), and it gives reduced-motion a truthful treatment for free: the tick
 * simply slows to 1 Hz, so the bar steps instead of gliding while still
 * saying something true at every moment. Freezing it to 100% — the correct
 * reduced-motion treatment for a *transition* — would assert that a 15-second
 * door had already finished.
 *
 * The remaining seconds are shown as a number as well as a bar. On a wall
 * panel a person wants to know whether to wait or walk away, and that is a
 * question a bar answers only approximately.
 */
export function DeterminateProgress({
  durationSeconds,
  label,
  sub,
}: DeterminateProgressProps) {
  const reduced = useReducedMotion();
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number>(Date.now());

  useEffect(() => {
    startedAt.current = Date.now();
    setElapsed(0);
    const tick = reduced ? 1000 : 100;
    const t = setInterval(() => {
      setElapsed((Date.now() - startedAt.current) / 1000);
    }, tick);
    return () => clearInterval(t);
  }, [durationSeconds, reduced]);

  const pct = Math.min(100, (elapsed / durationSeconds) * 100);
  const remaining = Math.max(0, Math.ceil(durationSeconds - elapsed));

  /**
   * Spec §1.1: "At 22 seconds, add a reassurance beat around 8-10s ... so it
   * doesn't read as a hang." Only for waits long enough to need it — on
   * locker 2's 5-second door it would appear and vanish, which is noise.
   */
  const showReassurance = durationSeconds >= 15 && elapsed >= 8;

  return (
    <div className="ld-determinate">
      <p className="ld-label">{label}</p>
      {sub ? <p className="ld-sub">{sub}</p> : null}

      <div
        className="ld-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={label}
      >
        <div
          className={`ld-bar-fill${reduced ? " ld-stepped" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="ld-seconds">
        {remaining > 0 ? `${remaining}s remaining` : "Finishing up…"}
      </p>

      {showReassurance ? (
        <p className="ld-reassurance">
          Still working — this locker takes about {Math.round(durationSeconds)}{" "}
          seconds. Please wait.
        </p>
      ) : null}
    </div>
  );
}

// ── §1.2 STAGED ─────────────────────────────────────────────────────────────

export interface StagedProgressProps {
  /** The real, ordered stage names. */
  stages: string[];
  /**
   * Index of the stage genuinely in progress, from a real signal.
   *
   * **Omit it when there is no real signal.** The spec allows exactly two
   * honest options — "advance on real signal, or show the current stage
   * without a fake progress bar underneath it" — and inventing a position
   * from a timer is neither. When this is undefined the component renders
   * the stages as *what the check consists of*, with nothing marked done.
   */
  currentStage?: number;
  label: string;
  sub?: string;
}

/**
 * Named, ordered stages — the treatment for a wait whose steps are real but
 * whose duration is not.
 *
 * Today the kiosk receives ONE `verifying_item` status for the whole ML
 * pipeline, so `currentStage` is genuinely unknown and this renders the list
 * without claiming a position. That is not a placeholder: it is the honest
 * rendering of what is actually known, and it is already better than a bare
 * spinner because a person can see the check is a real multi-step process
 * rather than a hang. The moment Node forwards per-stage progress, passing
 * `currentStage` lights this up with no other change — which is why the prop
 * exists now rather than being added later.
 */
export function StagedProgress({
  stages,
  currentStage,
  label,
  sub,
}: StagedProgressProps) {
  const known = typeof currentStage === "number";

  return (
    <div className="ld-staged">
      <p className="ld-label">{label}</p>
      {sub ? <p className="ld-sub">{sub}</p> : null}

      <ol className="ld-stages" aria-label={label}>
        {stages.map((name, i) => {
          const state = !known
            ? "pending"
            : i < currentStage!
              ? "done"
              : i === currentStage!
                ? "active"
                : "pending";
          return (
            <li key={name} className={`ld-stage ld-stage-${state}`}>
              <span className="ld-stage-dot" aria-hidden="true" />
              <span className="ld-stage-name">{name}</span>
            </li>
          );
        })}
      </ol>

      {!known ? (
        <p className="ld-staged-note">
          These checks run one after another. We can’t say which one is running
          right now, so nothing above is marked complete.
        </p>
      ) : null}
    </div>
  );
}

// ── §1.3 INDETERMINATE ──────────────────────────────────────────────────────

export interface IndeterminateProgressProps {
  label: string;
  sub?: string;
  /**
   * Seconds left on the kiosk session (§2.3 — the 120s store). Optional
   * because not every indeterminate wait sits inside a session.
   */
  countdownSeconds?: number;
  /** e.g. "Attempt 2 of 4". Rendered verbatim. */
  attemptLabel?: string;
}

/**
 * An honest indeterminate indicator: a looping track with NO percentage,
 * because there is no percentage to give.
 *
 * On this surface it belongs to `capturing` — the camera capture, which is
 * the one kiosk wait with no configured duration to draw on. It deliberately
 * does NOT go on the face-wait screen: `ANIMATION-AND-LOADING-SPEC.md` §2
 * gives the kiosk a *passive* waiting state there and puts the progress,
 * the session countdown and "attempt N of 4" on the PHONE, which is where
 * the person is actually acting. `FaceScreen` already implements that
 * correctly and is left alone.
 *
 * `countdownSeconds` and `attemptLabel` exist for the phone-side mirror of
 * this primitive rather than for any kiosk caller.
 *
 * Under reduced motion the sweep is replaced by a slow opacity pulse in CSS
 * rather than being frozen: an indeterminate indicator has no end state to
 * freeze to, and a motionless one is indistinguishable from a crashed screen,
 * which is the single thing this component exists to prevent.
 */
export function IndeterminateProgress({
  label,
  sub,
  countdownSeconds,
  attemptLabel,
}: IndeterminateProgressProps) {
  // Non-red until genuinely low (§2.3: "visible, calm, non-red until
  // genuinely low"). 20s is roughly one more attempt's worth of time.
  const low = typeof countdownSeconds === "number" && countdownSeconds <= 20;

  return (
    <div className="ld-indeterminate">
      <p className="ld-label">{label}</p>
      {sub ? <p className="ld-sub">{sub}</p> : null}

      <div
        className="ld-track"
        role="progressbar"
        aria-label={label}
        // No aria-valuenow: this is an indeterminate progressbar, and the
        // ARIA spec says an indeterminate one omits it rather than guessing.
      >
        <div className="ld-sweep" />
      </div>

      <div className="ld-meta">
        {attemptLabel ? (
          <span className="ld-attempt">{attemptLabel}</span>
        ) : null}
        {typeof countdownSeconds === "number" ? (
          <span className={`ld-countdown${low ? " ld-countdown-low" : ""}`}>
            {countdownSeconds > 0
              ? `${countdownSeconds}s left in this session`
              : "Session expired — please scan again"}
          </span>
        ) : null}
      </div>
    </div>
  );
}
