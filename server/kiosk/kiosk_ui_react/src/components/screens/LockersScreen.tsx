import { motion } from "framer-motion";

/**
 * "Locker status" — mandate §4.
 *
 * The main screen already shows four small pills; this is the version worth
 * walking up to. It answers the one question a person standing here actually
 * has — "is there space for my item right now" — and explains what a locker
 * being in use means, which the pills alone never did.
 *
 * Deliberately shows bay state only. Which rental occupies which door is not
 * public information, and this is an unauthenticated screen on a machine in
 * a corridor.
 */
export function LockersScreen({
  lockers,
  onBack,
}: {
  lockers: Record<string, boolean>;
  onBack: () => void;
}) {
  const ids = ["1", "2", "3", "4"];
  const free = ids.filter((id) => !lockers[id]).length;

  return (
    <div className="screen screen-info">
      <header className="info-head">
        <button type="button" className="info-back" onClick={onBack}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M9 5 4 12l5 7M4 12h16" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
        <div className="info-head-text">
          <p className="info-eyebrow">This kiosk</p>
          <h1 className="info-title">Locker bay status</h1>
        </div>
      </header>

      <div className="lockers-summary">
        <div className="lockers-count">
          <span className="lockers-count-n">{free}</span>
          <span className="lockers-count-of">of {ids.length}</span>
        </div>
        <p className="lockers-count-label">
          {free === 0
            ? "All doors are currently holding an item. One frees up as soon as a rental is collected."
            : free === ids.length
              ? "Every door is empty and ready for a drop-off."
              : `${free} ${free === 1 ? "door is" : "doors are"} empty and ready for a drop-off.`}
        </p>
      </div>

      <div className="info-scroll">
        <div className="locker-bay">
          {ids.map((id, i) => {
            const occupied = !!lockers[id];
            return (
              <motion.div
                key={id}
                className={`bay-door ${occupied ? "occupied" : "free"}`}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.06 + i * 0.08, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              >
                <span className="bay-num">{id.padStart(2, "0")}</span>
                <span className="bay-hinge" aria-hidden />
                <span className="bay-state">{occupied ? "In use" : "Free"}</span>
                <span className="bay-icon" aria-hidden>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    {occupied ? (
                      <>
                        <rect x="5" y="11" width="14" height="10" rx="1.5" strokeWidth="1.7" />
                        <path d="M8 11V7.5a4 4 0 0 1 8 0V11" strokeWidth="1.7" strokeLinecap="round" />
                      </>
                    ) : (
                      <>
                        <rect x="5" y="11" width="14" height="10" rx="1.5" strokeWidth="1.7" />
                        <path d="M8 11V7.5a4 4 0 0 1 7.5-2" strokeWidth="1.7" strokeLinecap="round" />
                      </>
                    )}
                  </svg>
                </span>
              </motion.div>
            );
          })}
        </div>

        <div className="lockers-note">
          <p>
            <strong>A door that's in use isn't a blocked kiosk.</strong> You can
            still collect or return — the system assigns the right door for your
            rental when you scan in.
          </p>
          <p>
            Doors are opened only after a valid short-lived QR token and a face
            check. There is no manual override on this screen.
          </p>
        </div>
      </div>

      <footer className="info-foot">
        <span>Bay status updates live from the locker controller.</span>
        <button type="button" className="info-cta" onClick={onBack}>
          Back to the code
        </button>
      </footer>
    </div>
  );
}
