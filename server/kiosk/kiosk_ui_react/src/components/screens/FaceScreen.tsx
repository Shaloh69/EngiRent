interface Props {
  instr: string;
  onCancel: () => void;
}

/**
 * Waiting screen — design mandate §4.7.
 *
 * Until 2026-09-03 this screen showed a live face-camera feed and drove its
 * own capture/retry loop. The face camera has been physically removed:
 * verification now happens on the user's phone (§2.13), and this screen's
 * only job is to say so and wait for Node to report the outcome (open_door
 * on success, or a "face_failed" kiosk:command on a bad match).
 *
 * No camera feed, no progress bar pretending the kiosk is doing work it
 * isn't. A single instruction naming the device the user should actually be
 * looking at, an animated indicator that reads as "waiting" rather than
 * "processing" (mandate's rule against a bare spinner as the whole screen —
 * §2.2), and a real, always-available way out — this step can end without a
 * success (abandoned, or a bad match), and a screen only escapable by
 * succeeding strands the next person behind a stuck kiosk.
 */
export function FaceScreen({ instr, onCancel }: Props) {
  return (
    <div className="screen screen-face screen-face--waiting">
      <header className="flow-bar">
        <button className="flow-back" onClick={onCancel} aria-label="Cancel">
          ‹
        </button>
        <h2 className="flow-title">Identity Verification</h2>
        <span className="flow-step">Step 3 of 3</span>
      </header>

      <div className="face-wait">
        <div className="face-wait-badge">
          <span className="face-wait-pulse" />
          <PhoneGlyph />
        </div>
        <p className="face-wait-headline">Check your phone</p>
        <p className="face-wait-instr">{instr}</p>
      </div>

      <div className="flow-foot">
        <button className="flow-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function PhoneGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="40" height="40" fill="none" aria-hidden="true">
      <rect x="6" y="2" width="12" height="20" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <line x1="10" y1="18.5" x2="14" y2="18.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
