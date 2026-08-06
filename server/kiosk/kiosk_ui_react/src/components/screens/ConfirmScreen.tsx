import { motion } from "framer-motion";
import type { RentalInfo } from "../../types";

interface Props {
  rentalInfo: RentalInfo | null;
  rentalId: string | null;
  confirmAction: string;
  confirmNotice: string;
  onBack: () => void;
  onProceed: () => void;
  onCancel: () => void;
}

export function ConfirmScreen({
  rentalInfo,
  rentalId,
  confirmAction,
  confirmNotice,
  onBack,
  onProceed,
  onCancel,
}: Props) {
  const status = (rentalInfo?.status ?? "UNKNOWN").toUpperCase();
  const item = rentalInfo?.item?.title ?? rentalInfo?.item?.name ?? "Unknown Item";
  const owner =
    [rentalInfo?.owner?.firstName, rentalInfo?.owner?.lastName].filter(Boolean).join(" ") || "—";

  return (
    <div className="screen screen-confirm">
      <header className="flow-bar">
        <button className="flow-back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <h2 className="flow-title">Confirm Details</h2>
        <span className="flow-step">Step 2 of 3</span>
      </header>

      <div className="confirm-scroll">
        <motion.div
          className="rental-card"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <span className={`rental-badge badge-${status.toLowerCase()}`}>
            {status.replace(/_/g, " ")}
          </span>
          <p className="rental-item-name">{item}</p>
          <div className="rental-grid">
            <div className="rental-field">
              <span className="field-label">Locker</span>
              <span className="field-val">{rentalInfo?.depositLockerId ?? "—"}</span>
            </div>
            <div className="rental-field">
              <span className="field-label">Owner</span>
              <span className="field-val">{owner}</span>
            </div>
            <div className="rental-field">
              <span className="field-label">Action</span>
              <span className="field-val">{confirmAction}</span>
            </div>
            <div className="rental-field">
              <span className="field-label">Rental ID</span>
              <span className="field-val mono">
                {rentalId ? `${rentalId.substring(0, 20)}…` : "—"}
              </span>
            </div>
          </div>
        </motion.div>

        <div className="confirm-notice">
          <span className="notice-icon">ℹ</span>
          <span>{confirmNotice}</span>
        </div>
      </div>

      <div className="confirm-foot">
        <button className="cfm-btn btn-proceed" onClick={onProceed}>
          Proceed to Verification →
        </button>
        <button className="cfm-btn btn-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
