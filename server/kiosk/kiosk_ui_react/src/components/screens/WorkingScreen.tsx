import {
  DeterminateProgress,
  IndeterminateProgress,
} from "../loading/LoadingPrimitives";

export type WorkingKind = "door_open" | "dropping" | "capturing";

interface Props {
  kind: WorkingKind;
  label: string;
  sub: string;
  /**
   * Real duration from the Pi, when it sends one. Absent means unknown, and
   * unknown renders indeterminate — see below.
   */
  durationSeconds?: number;
}

/**
 * E3.2 / `ANIMATION-AND-LOADING-SPEC.md` §1.1 — the hardware waits.
 *
 * **This screen did not exist.** The Pi emits `door_open`, `dropping` and
 * `capturing`, and `useKioskState` branched on none of them, so the longest
 * waits in the whole product happened with the main menu on screen: a door
 * held open for **15 s** on lockers 1, 3 and 4, and a place sequence of
 * **34–46 s** (extend then retract). The spec's whole §1.1 is about that
 * wait, and it had no home.
 *
 * **Why the duration is a prop and not a lookup.** The obvious implementation
 * is to read `main_door_open_seconds` out of `kiosk_config.json`. It is
 * wrong: the admin console can send a `duration_override`
 * (`adminController.ts:1178`), and then the bar and the door disagree while
 * someone stands watching both. The number has to come from the handler that
 * actually drives the solenoid.
 *
 * **Until the Pi sends it, this renders INDETERMINATE.** That is deliberate
 * and it is the same rule D-53 established: absent is not a licence to
 * invent. A canned bar over a hardware wait is the single thing §1.1 bans —
 * *"a canned 3-second 'opening' animation on a locker that takes 22 seconds
 * is a lie the user will catch."* An honest "working…" is worth more than a
 * confident wrong one, and the moment `duration_seconds` arrives this becomes
 * a real determinate bar with no further change here.
 */
export function WorkingScreen({ kind, label, sub, durationSeconds }: Props) {
  // `capturing` has no configured duration anywhere — there is nothing to be
  // determinate about, so it is indeterminate by nature rather than by
  // fallback.
  const canBeDeterminate =
    kind !== "capturing" &&
    typeof durationSeconds === "number" &&
    durationSeconds > 0;

  return (
    <div className="screen screen-working">
      {/* No flow-bar header. An earlier revision put `label` there AND passed
          it to the primitive, so the panel showed the same sentence twice --
          invisible in the DOM probe (both were correct individually) and
          obvious the moment the 1080x1920 capture was opened. There is also
          deliberately no back/cancel control: a solenoid mid-cycle cannot be
          called off, and offering a button that does nothing is worse than
          offering none. */}
      <div className="working-body">
        {canBeDeterminate ? (
          <DeterminateProgress
            durationSeconds={durationSeconds!}
            label={label}
            sub={sub}
          />
        ) : (
          <IndeterminateProgress label={label} sub={sub} />
        )}

        {/* The instruction has to outlive the wait. D-55: the success screen
            said "please collect your item and close the door" and returned to
            the menu after 5s while a 15s door was still cycling. */}
        <p className="working-instr">
          {kind === "capturing"
            ? "Hold still — the kiosk is photographing the bay."
            : "Please stay at the kiosk until this finishes."}
        </p>
      </div>
    </div>
  );
}
