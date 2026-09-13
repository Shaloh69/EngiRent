interface Props {
  message: string;
  onRetry: () => void;
  onHome: () => void;
  /**
   * "error" is a fault: something broke and the person may be stuck.
   * "retry" is the normal item-verification outcome — the kiosk looked, was
   * not sure, and the door is open again. Before 2026-09-14 a retry verdict
   * sent this screen straight back to the QR screen (useKioskState.ts:263),
   * throwing away the one instruction that mattered, which is why it read as
   * "the kiosk keeps starting over" to the person standing at it.
   */
  tone?: "error" | "retry";
}

export function ErrorScreen({ message, onRetry, onHome, tone = "error" }: Props) {
  const isRetry = tone === "retry";
  return (
    <div className={`screen screen-error${isRetry ? " screen-error-retry" : ""}`}>
      <div className="error-wrap">
        <div className="error-icon">
          <span>{isRetry ? "↺" : "✕"}</span>
        </div>
        <h1 className="error-title">
          {isRetry ? "Try that again" : "Something went wrong"}
        </h1>
        <p className="error-msg">{message}</p>
        {isRetry && (
          <p className="error-msg error-msg-sub">
            The locker is open again. Reposition the item so the whole of it is
            visible, close the door, then tap <b>Item is placed</b> on your phone.
          </p>
        )}
        <div className="error-btns">
          <button className="err-btn btn-retry" onClick={onRetry}>
            {isRetry ? "Start Over" : "Try Again"}
          </button>
          <button className="err-btn btn-err-home" onClick={onHome}>
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
