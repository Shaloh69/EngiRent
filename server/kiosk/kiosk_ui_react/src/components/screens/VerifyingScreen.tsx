import { motion } from "framer-motion";

export function VerifyingScreen({ sub }: { sub: string }) {
  return (
    <div className="screen screen-verifying">
      <div className="success-wrap">
        <motion.div
          className="verifying-spinner"
          animate={{ rotate: 360 }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
        />
        <h1 className="success-title">Checking your item…</h1>
        <p className="success-sub">{sub}</p>
        <p className="verifying-warning">
          Please do not walk away yet — verification is still in progress.
        </p>
      </div>
    </div>
  );
}
