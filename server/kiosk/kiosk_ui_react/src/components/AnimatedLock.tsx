import { motion } from "framer-motion";

export type LockState = "locked" | "unlocking" | "unlocked";

/**
 * A hand-built SVG + Framer Motion lock with a real locked -> unlocking ->
 * unlocked state machine (shackle rotates open, body glows on unlock) —
 * the design mandate's preferred tool for this is a sourced Lottie asset
 * from LottieFiles, but no specific asset was available to fetch in this
 * environment. This achieves the same three-state effect through code
 * instead, without an external JSON dependency.
 */
export function AnimatedLock({
  state,
  size = 140,
}: {
  state: LockState;
  size?: number;
}) {
  const shackleOpen = state !== "locked";
  const glow = state === "unlocked";

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      animate={glow ? { scale: [1, 1.06, 1] } : { scale: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <defs>
        <filter id="lock-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation={glow ? 6 : 0} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Shackle */}
      <motion.path
        d="M40 52 V38 a20 20 0 0 1 40 0 V52"
        stroke={glow ? "#F5A623" : "#7C3AED"}
        strokeWidth={8}
        strokeLinecap="round"
        fill="none"
        style={{ originX: "40px", originY: "52px" }}
        animate={{ rotate: shackleOpen ? -35 : 0 }}
        transition={{ duration: 0.5, ease: "easeInOut" }}
      />

      {/* Body */}
      <rect
        x={26}
        y={50}
        width={68}
        height={54}
        rx={12}
        fill={glow ? "#F5A623" : "#7C3AED"}
        filter="url(#lock-glow)"
      />

      {/* Keyhole */}
      <circle cx={60} cy={72} r={7} fill="#08060d" />
      <rect x={56} y={76} width={8} height={16} rx={3} fill="#08060d" />
    </motion.svg>
  );
}
