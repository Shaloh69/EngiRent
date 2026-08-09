import { motion } from "framer-motion";

/**
 * "How it works" — mandate §4.
 *
 * The kiosk stands in a corridor and is, for most people who walk past it,
 * the only EngiRent surface they will ever touch. Its job is not purely
 * transactional: someone who has never heard of the service should be able
 * to stand here for a minute and leave understanding it. This screen is that
 * minute, and it deliberately mirrors client/web's homepage so the two tell
 * one story rather than two.
 */

const STAGES = [
  {
    n: "01",
    label: "A student lists their gear",
    body: "Calculators, Arduino kits, lab gowns, measuring tools — anything an Engineering student already owns and isn't using this term. They set a daily rate and a refundable deposit.",
    accent: "teal",
  },
  {
    n: "02",
    label: "The renter books and pays",
    body: "Dates are chosen in the app. Both the rental fee and the refundable deposit are held before anything physically moves — nobody is out of pocket on trust alone.",
    accent: "teal",
  },
  {
    n: "03",
    label: "The owner deposits at this kiosk",
    body: "They drop the item into a smart locker. Cameras photograph its condition on the way in, which is the record everything later is measured against.",
    accent: "gold",
  },
  {
    n: "04",
    label: "The renter collects",
    body: "A short-lived QR token pairs their phone with the kiosk, and a face check confirms who they are. The correct door opens. No staff, no meet-up, no coordinating schedules.",
    accent: "gold",
  },
  {
    n: "05",
    label: "AI checks the return",
    body: "On return, an 8-stage computer-vision pipeline compares the deposit and return photographs and scores the match, so condition disputes are settled by evidence rather than memory.",
    accent: "coral",
  },
  {
    n: "06",
    label: "Everyone gets settled",
    body: "The deposit is refunded net of any late or damage fees, and the owner is paid out automatically. The locker is released for the next rental.",
    accent: "emerald",
  },
];

export function HowScreen({ onBack }: { onBack: () => void }) {
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
          <p className="info-eyebrow">How it works</p>
          <h1 className="info-title">Six steps, one controlled lifecycle</h1>
        </div>
      </header>

      <p className="info-lede">
        Every stage is enforced by the system rather than by trust. This is the
        flow the thesis set out to make safe.
      </p>

      <div className="info-scroll">
        <ol className="how-list">
          {STAGES.map((s, i) => (
            <motion.li
              key={s.n}
              className={`how-item accent-${s.accent}`}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 + i * 0.07, duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="how-rail">
                <span className="how-n">{s.n}</span>
                {i < STAGES.length - 1 && <span className="how-line" />}
              </div>
              <div className="how-text">
                <h2>{s.label}</h2>
                <p>{s.body}</p>
              </div>
            </motion.li>
          ))}
        </ol>
      </div>

      <footer className="info-foot">
        <span>Get the app to start renting — free for UCLM students.</span>
        <button type="button" className="info-cta" onClick={onBack}>
          Back to the code
        </button>
      </footer>
    </div>
  );
}
