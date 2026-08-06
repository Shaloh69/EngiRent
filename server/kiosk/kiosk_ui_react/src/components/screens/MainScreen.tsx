import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { QRCodeCanvas } from "qrcode.react";

interface Props {
  offline: boolean;
  lockers: Record<string, boolean>;
  sessionQrConnected: boolean;
  sessionQrUser: string | null;
  isDemo: boolean;
}

export function MainScreen({ offline, lockers, sessionQrConnected, sessionQrUser, isDemo }: Props) {
  const [now, setNow] = useState(new Date());
  const [token, setToken] = useState<string | null>(isDemo ? "demo-session-token" : null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    const refresh = () => {
      fetch("/api/qr-token")
        .then((r) => r.json())
        .then((d) => {
          if (!cancelled && d.token) setToken(d.token);
        })
        .catch(() => {});
    };
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [isDemo]);

  return (
    <div className="screen screen-main">
      <header className="top-bar">
        <div className="top-brand">
          <div className="top-logo">ER</div>
          <div className="top-text">
            <span className="top-sub">Smart Kiosk</span>
            <span className="top-name">EngiRent Hub</span>
          </div>
        </div>
        <span className={`conn-badge ${offline ? "badge-offline" : "badge-online"}`}>
          {offline ? "Offline" : "Online"}
        </span>
      </header>

      <main className="main-body">
        <motion.div
          className="qr-hero-panel"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <div className="qr-hero-left">
            <div className="qr-hero-canvas-wrap">
              {token ? (
                <QRCodeCanvas value={token} size={220} bgColor="#ffffff" fgColor="#08060d" />
              ) : (
                <div className="session-qr-spinner">
                  <span className="spin-ring" />
                </div>
              )}
            </div>
          </div>
          <div className="qr-hero-right">
            <p className="qr-hero-eyebrow">EngiRent Kiosk</p>
            <h2 className="qr-hero-title">Scan with your phone</h2>
            <ol className="qr-hero-steps">
              <li>
                Open the <strong>EngiRent</strong> app
              </li>
              <li>
                Go to <strong>My Rentals</strong>
              </li>
              <li>
                Tap <strong>Place Item</strong> or <strong>Retrieve Item</strong>
              </li>
              <li>Point your camera at this QR code</li>
            </ol>
            <div
              className={`session-qr-status ${sessionQrConnected ? "connected" : "waiting"}`}
            >
              <span className="session-qr-dot" />
              <span>{sessionQrConnected ? `${sessionQrUser ?? "User"} connected` : "Waiting for scan…"}</span>
            </div>
            <p className="qr-hero-refresh">QR code refreshes automatically</p>
          </div>
        </motion.div>

        <div className="locker-row">
          <span className="locker-row-label">Lockers</span>
          <div className="locker-pills">
            {["1", "2", "3", "4"].map((id) => (
              <div key={id} className={`locker-pill ${lockers[id] ? "occupied" : ""}`}>
                <span>{id.padStart(2, "0")}</span>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="bot-bar">
        <span>UC Lapu-Lapu and Mandaue · Engineering Thesis 2026</span>
        <span>
          {now.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      </footer>
    </div>
  );
}
