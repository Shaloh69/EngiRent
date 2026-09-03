/**
 * Vestigial screen — kept but effectively dead, not deleted (2026-09-03).
 *
 * This is the *reversed* hand-off direction: the kiosk scanning a QR shown
 * on the user's phone. That's backwards from how hand-off actually works
 * (MainScreen displays the kiosk's own code; the phone scans it with
 * mobile_scanner). Under app-first-only, every real session starts with a
 * rentalId already known, so the app-side flow never routes here.
 *
 * The `/camera/face/stream` feed below is now a 404 — its camera was
 * physically removed the same day (design mandate §2.13). Left in place
 * rather than deleted to bound the size of that change; a candidate for a
 * real removal pass alongside ConfirmScreen and the "qr"/"confirm" states in
 * useKioskState.ts, which are equally unreachable now.
 */
interface Props {
  onBack: () => void;
  status: "scanning" | "found" | "error";
  isDemo: boolean;
}

export function QrScreen({ onBack, status, isDemo }: Props) {
  const ts = Date.now();
  return (
    <div className="screen screen-qr">
      <header className="flow-bar">
        <button className="flow-back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <h2 className="flow-title">Scan QR Code</h2>
        <span className="flow-step">Step 1 of 3</span>
      </header>

      <div className="cam-wrap">
        {!isDemo && <img className="cam-feed" src={`/camera/face/stream?t=${ts}`} alt="Camera" />}
        {isDemo && <div className="cam-feed cam-feed--placeholder">Camera preview (demo mode)</div>}
        <div className="qr-overlay">
          <div className="qr-region">
            <span className="qr-c qr-tl" />
            <span className="qr-c qr-tr" />
            <span className="qr-c qr-bl" />
            <span className="qr-c qr-br" />
            <div className="qr-scanline" />
          </div>
          <p className="qr-hint">Hold your QR code in frame</p>
        </div>
      </div>

      <div className="flow-foot">
        <div className="scan-status">
          {status === "scanning" && <span className="spin-ring" />}
          {status === "found" && <span className="status-ok">✓</span>}
          {status === "error" && <span className="status-err">⚠</span>}
          <span>
            {status === "scanning" && "Looking for QR code…"}
            {status === "found" && "QR detected! Loading info…"}
            {status === "error" && "Error reading QR code"}
          </span>
        </div>
        <p className="flow-foot-hint">Open the EngiRent app → My Rentals → show QR code</p>
      </div>
    </div>
  );
}
