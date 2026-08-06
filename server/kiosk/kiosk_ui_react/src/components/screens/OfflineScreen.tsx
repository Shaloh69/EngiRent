import { motion } from "framer-motion";

/**
 * Design-mandate requirement (docs/planning/02-design-mandate.md §4): "a
 * kiosk that freezes or shows a raw API error on a lost connection is a much
 * worse failure than the same failure in a phone app" — this is a real,
 * dedicated fallback screen, not just the small connection badge the
 * original vanilla-JS UI had. Shown whenever the backend Socket.IO
 * connection has been down for more than a few seconds (see
 * useKioskState's OFFLINE_GRACE_MS), overlaying whatever screen was active.
 */
export function OfflineScreen() {
  return (
    <div className="screen screen-offline">
      <motion.div
        className="offline-wrap"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <motion.span
          className="offline-icon"
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          ⚠
        </motion.span>
        <h1>Temporarily Unavailable</h1>
        <p>This kiosk has lost connection to the server.</p>
        <p className="offline-hint">
          Please use the EngiRent mobile app instead, or try again in a moment.
        </p>
      </motion.div>
    </div>
  );
}
