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
  occupancy,
  onBack,
}: {
  /**
   * Per-bay LockerStatus from the server. D-53.
   *
   * The `lockers` prop this screen used to take is GONE, and the compiler is
   * what pointed it out: once availability came from occupancy, door state was
   * unused here. That is the right shape. Door state answers "is this door
   * physically open right now", which is a live hardware fact lasting seconds;
   * this screen answers "which bays can I drop into", which is occupancy. They
   * were being conflated, and conflating them is the whole of D-53.
   */
  occupancy?: Record<string, string> | null;
  onBack: () => void;
}) {
  const ids = ["1", "2", "3", "4"];

  // D-53. This used to be `ids.filter((id) => !lockers[id]).length`, i.e. it
  // counted bays with no door standing open and called them "empty and ready
  // for a drop-off". `lockers[id]` is DOOR state: a door reads unlocked only
  // for the few seconds it is physically open during a handover. So the count
  // was ~4 essentially always, whatever the bays actually held.
  //
  // Availability comes from the server's LockerStatus now. When that has not
  // arrived we say so, because the honest answer to "how many are free" is
  // sometimes "I do not know yet" -- and on a wall panel a confident wrong
  // number sends a student to a door that is not free.
  const known = occupancy != null && ids.some((id) => occupancy[id]);
  const free = known
    ? ids.filter((id) => occupancy![id] === "AVAILABLE").length
    : null;
  const outOfService = known
    ? ids.filter((id) =>
        ["MAINTENANCE", "OUT_OF_SERVICE"].includes(occupancy![id]),
      ).length
    : 0;

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
          <span className="lockers-count-n">{free ?? "—"}</span>
          <span className="lockers-count-of">of {ids.length}</span>
        </div>
        <p className="lockers-count-label">
          {!known
            ? "Waiting for the locker controller to report bay status."
            : free === 0
              ? "Every bay is currently holding an item. One frees up as soon as a rental is collected."
              : free === ids.length
                ? "Every bay is empty and ready for a drop-off."
                : `${free} ${free === 1 ? "bay is" : "bays are"} empty and ready for a drop-off.`}
          {known && outOfService > 0
            ? ` ${outOfService} ${outOfService === 1 ? "bay is" : "bays are"} out of service.`
            : ""}
        </p>
      </div>

      <div className="info-scroll">
        <div className="locker-bay">
          {ids.map((id, i) => {
            // D-53: these cards had the same bug as the summary above --
            // `!!lockers[id]` is DOOR state, so every bay read "Free" whenever
            // no door happened to be standing open. Leaving them while fixing
            // only the summary would have been worse than leaving both: the
            // screen would say "waiting for bay status" over four confident
            // FREE cards.
            const state = occupancy?.[id];
            const label = !state
              ? "Unknown"
              : state === "AVAILABLE"
                ? "Free"
                : state === "OCCUPIED"
                  ? "In use"
                  : state === "RESERVED"
                    ? "Reserved"
                    : "Out of service";
            const occupied = state === "OCCUPIED" || state === "RESERVED";
            const unusable =
              state === "MAINTENANCE" || state === "OUT_OF_SERVICE";
            return (
              <motion.div
                key={id}
                className={`bay-door ${
                  !state ? "unknown" : unusable ? "occupied" : occupied ? "occupied" : "free"
                }`}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.06 + i * 0.08, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              >
                <span className="bay-num">{id.padStart(2, "0")}</span>
                <span className="bay-hinge" aria-hidden />
                <span className="bay-state">{label}</span>
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
