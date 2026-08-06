import { motion } from "framer-motion";
import { AnimatedLock } from "../AnimatedLock";

interface Props {
  sub: string;
  instr: string;
  countdown: number;
}

export function SuccessScreen({ sub, instr, countdown }: Props) {
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
        <h1 className="success-title">Access Granted!</h1>
        <p className="success-sub">{sub}</p>
        <p className="success-instr">{instr}</p>
        <div className="countdown-wrap">
          <div className="countdown-bar">
            <motion.div
              className="countdown-fill"
              initial={{ width: "100%" }}
              animate={{ width: "0%" }}
              transition={{ duration: 5, ease: "linear" }}
            />
          </div>
          <p className="countdown-label">Returning home in {countdown}s</p>
        </div>
      </div>
    </div>
  );
}
