import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { QRCodeCanvas } from "qrcode.react";

interface Props {
  offline: boolean;
  lockers: Record<string, boolean>;
  sessionQrConnected: boolean;
  sessionQrUser: string | null;
  isDemo: boolean;
  onHow: () => void;
  onCatalogue: () => void;
  onLockers: () => void;
  onIdle: () => void;
}

/**
 * Main menu — mandate §4, rebuilt for portrait.
 *
 * The previous layout put the QR code and its instructions side by side,
 * which is a landscape composition on a 1080x1920 vertical panel: the code
 * was small, the copy was cramped into a narrow column, and two thirds of
 * the screen's height went unused.
 *
 * Portrait now drives the structure — the code is large and centred at eye
 * level, its steps read straight down underneath it, and the lower third
 * carries the secondary options the screen previously had none of.
 *
 * The kiosk-industry rule "one primary task per screen" still holds: scanning
 * is the only *primary* action. The extra tiles are visually subordinate and
 * all informational — none of them start a transaction.
 */
export function MainScreen({
  offline,
  lockers,
  sessionQrConnected,
  sessionQrUser,
  isDemo,
  onHow,
  onCatalogue,
  onLockers,
  onIdle,
}: Props) {
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

  const free = ["1", "2", "3", "4"].filter((id) => !lockers[id]).length;

  return (
    <div className="screen screen-main">
      <header className="top-bar">
        <div className="top-brand">
          <div className="top-logo">ER</div>
          <div className="top-text">
            <span className="top-name">EngiRent Hub</span>
            <span className="top-sub">UCLM · Smart Locker Kiosk</span>
          </div>
        </div>
        <div className="top-right">
          <span className={`conn-badge ${offline ? "badge-offline" : "badge-online"}`}>
            <span className="conn-dot" />
            {offline ? "Offline" : "Online"}
          </span>
          <span className="top-clock">
            {now.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </header>

      <main className="main-body">
        <motion.section
          className="qr-panel"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="qr-eyebrow">Start here</p>
          <h2 className="qr-title">Scan this with your phone</h2>

          <div className="qr-canvas-wrap">
            {token ? (
              <>
                <QRCodeCanvas value={token} size={340} bgColor="#ffffff" fgColor="#04100e" />
                {/* Scanning reticle: four corner brackets, the near-universal
                    cue that a square is meant to be pointed a camera at. */}
                <span className="qr-bracket tl" />
                <span className="qr-bracket tr" />
                <span className="qr-bracket bl" />
                <span className="qr-bracket br" />
                <motion.span
                  className="qr-sweep"
                  animate={{ y: ["0%", "100%", "0%"] }}
                  transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
                />
              </>
            ) : (
              <div className="session-qr-spinner">
                <span className="spin-ring" />
              </div>
            )}
          </div>

          <ol className="qr-steps">
            <li>
              <span className="qr-step-n">1</span>
              Open <strong>EngiRent</strong> → <strong>My Rentals</strong>
            </li>
            <li>
              <span className="qr-step-n">2</span>
              Tap <strong>Place</strong>, <strong>Collect</strong> or <strong>Return</strong>
            </li>
            <li>
              <span className="qr-step-n">3</span>
              Point your camera at the code above
            </li>
          </ol>

          <div className={`session-qr-status ${sessionQrConnected ? "connected" : "waiting"}`}>
            <span className="session-qr-dot" />
            <span>
              {sessionQrConnected
                ? `${sessionQrUser ?? "User"} connected`
                : "Waiting for a phone to scan…"}
            </span>
          </div>
          <p className="qr-refresh">Code rotates every 30 seconds for security</p>
        </motion.section>

        <section className="menu-grid">
          <MenuTile
            onClick={onHow}
            delay={0.06}
            accent="teal"
            title="How it works"
            body="The six-step rental lifecycle, start to finish"
            icon={
              <path
                d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-14.5v.01M12 11v5.5"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            }
          />
          <MenuTile
            onClick={onCatalogue}
            delay={0.12}
            accent="gold"
            title="Browse gear"
            body="What students near you have listed right now"
            icon={
              <path
                d="M3 7h18M3 12h18M3 17h18"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            }
          />
          <MenuTile
            onClick={onLockers}
            delay={0.18}
            accent="emerald"
            title="Locker status"
            body={`${free} of 4 lockers free right now`}
            icon={
              <path
                d="M5 3h14v18H5zM12 10v3"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            }
          />
          <MenuTile
            onClick={onIdle}
            delay={0.24}
            accent="coral"
            title="Not you?"
            body="Return this kiosk to its welcome screen"
            icon={
              <path
                d="M9 5 4 12l5 7M4 12h16"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            }
          />
        </section>

      </main>

      <footer className="bot-bar">
        <span>UC Lapu-Lapu and Mandaue · Engineering Thesis 2026</span>
        <span className="bot-time">
          {now.toLocaleTimeString("en-PH", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      </footer>
    </div>
  );
}

function MenuTile({
  onClick,
  title,
  body,
  icon,
  accent,
  delay,
}: {
  onClick: () => void;
  title: string;
  body: string;
  icon: React.ReactNode;
  accent: "teal" | "gold" | "emerald" | "coral";
  delay: number;
}) {
  return (
    <motion.button
      type="button"
      className={`menu-tile accent-${accent}`}
      onClick={onClick}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
      whileTap={{ scale: 0.97 }}
    >
      <span className="menu-tile-icon">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          {icon}
        </svg>
      </span>
      <span className="menu-tile-title">{title}</span>
      <span className="menu-tile-body">{body}</span>
    </motion.button>
  );
}
