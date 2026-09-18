import { motion } from "framer-motion";
import { AnimatedLock } from "../AnimatedLock";

interface Props {
  sub: string;
  instr: string;
  countdown: number;
  /**
   * D-87b — an extra line for the "awaiting review" outcome, explaining what
   * happens after the person walks away. Absent on every other success, so the
   * ordinary "your locker is open" screen is unchanged.
   */
  note?: string | null;
}

export function SuccessScreen({ sub, instr, countdown, note }: Props) {
  return (
    <div className="screen screen-success">
      <div className="success-wrap">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 14 }}
        >
          <AnimatedLock state="unlocked" size={110} />
        </motion.div>
        <h1 className="success-title">{note ? "Item Placed!" : "Access Granted!"}</h1>
        <p className="success-sub">{sub}</p>
        <p className="success-instr">{instr}</p>
        {note && <p className="success-note">{note}</p>}
        <div className="countdown-wrap">
          <div className="countdown-bar">
            <motion.div
              className="countdown-fill"
              initial={{ width: "100%" }}
              animate={{ width: "0%" }}
              transition={{ duration: note ? 12 : 5, ease: "linear" }}
            />
          </div>
          <p className="countdown-label">Returning home in {countdown}s</p>
        </div>
      </div>
    </div>
  );
}
