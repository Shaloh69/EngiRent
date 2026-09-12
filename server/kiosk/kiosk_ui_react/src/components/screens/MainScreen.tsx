import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { QRCodeCanvas } from "qrcode.react";

/**
 * Demo seeds for the QR freshness ring (E4.2). Without these, `?demo=main`
 * renders a ring that is always full, and the one thing E4.2 adds -- that the
 * code visibly ages -- could not be looked at without a live Pi minting real
 * tokens.
 *
 *   ?demo=main                  full 90s lifetime, ring starts full
 *   ?demo=main&qr=12            12s left -- the ring near the end of its arc
 *   ?demo=main&qr=1             the rollover, a second before it happens
 *
 * Same precedent as `?demo=working&seconds=` in useKioskState.ts: demo-only,
 * read once at module scope, and unreachable on a live kiosk because nothing
 * appends a query string to the autostart URL.
 */
const DEMO_TTL = 90;
const DEMO_REMAINING = Number(new URLSearchParams(window.location.search).get("qr")) || DEMO_TTL;

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
  // The real token lifetime, from the server. Previously the caption below
  // hardcoded "30 seconds", which was the *poll* interval of the effect just
  // underneath — not the token's TTL, which is 90s (`_QR_TTL` in
  // kiosk_ui/server.py). The kiosk was telling people their code expired three
  // times faster than it does.
  const [ttl, setTtl] = useState<number | null>(isDemo ? DEMO_TTL : null);
  // E4.2 — the *freshness* of the code currently on screen, which is a
  // different fact from its lifetime and the one a person standing here can
  // act on. `/api/qr-token` has always returned `expires_in` (the real
  // remaining seconds, `server.py`'s `remaining`); the client read only `ttl`
  // and threw the live number away. Held as an absolute deadline rather than
  // a counter, the same shape E3.2 used for the phone's 120s countdown, so
  // the ring cannot drift away from the server between polls.
  const [deadline, setDeadline] = useState<number | null>(
    isDemo ? Date.now() + DEMO_REMAINING * 1000 : null,
  );

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Derived from the 1s clock tick above rather than a second timer of its
  // own — one heartbeat on this screen, not two racing each other.
  const remaining =
    deadline === null ? null : Math.max(0, Math.ceil((deadline - now.getTime()) / 1000));
  const freshness = ttl && remaining !== null ? Math.min(1, Math.max(0, remaining / ttl)) : null;

  const inFlight = useRef(false);
  const refresh = useCallback(() => {
    if (isDemo || inFlight.current) return;
    inFlight.current = true;
    fetch("/api/qr-token")
      .then((r) => r.json())
      .then((d) => {
        if (d.token) setToken(d.token);
        if (typeof d.ttl === "number" && d.ttl > 0) setTtl(d.ttl);
        if (typeof d.expires_in === "number") setDeadline(Date.now() + d.expires_in * 1000);
      })
      .catch(() => {})
      .finally(() => {
        inFlight.current = false;
      });
  }, [isDemo]);

  useEffect(() => {
    if (isDemo) return;
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [isDemo, refresh]);

  // The poll is 30s and the token lives 90s, so the displayed code could sit
  // dead for up to a poll interval: `get_qr_token()` only mints a replacement
  // when something asks it to, and nothing asked between expiry and the next
  // tick. Anyone scanning in that window got a rejection from a code the
  // kiosk was still showing as valid. Now the countdown reaching zero is
  // itself the trigger to go and fetch the successor.
  useEffect(() => {
    if (isDemo || remaining === null || remaining > 0) return;
    refresh();
  }, [isDemo, remaining, refresh]);

  // Demo mode has no backend, so roll the deadline over by hand to show the
  // rotation itself, not just a ring that empties once and stops.
  useEffect(() => {
    if (!isDemo || remaining === null || remaining > 0) return;
    setDeadline(Date.now() + DEMO_TTL * 1000);
  }, [isDemo, remaining]);

  const free = ["1", "2", "3", "4"].filter((id) => !lockers[id]).length;

  return (
    <div className="screen screen-main">
      {/* Title block, matching client/web's header. The previous bar was a
          wordmark with a status pill and a clock floated to the right — a web
          page's chrome on a machine. A ruled title block reads as equipment,
          and it makes the facts a person standing here might want (is it
          online, how many doors are free, what time is it) ambient rather
          than incidental. */}
      <header className="top-bar">
        <div className="tb-k-brand">
          <div className="top-logo">ER</div>
          <div className="top-text">
            <span className="top-name">EngiRent Hub</span>
            <span className="top-sub">UCLM · Smart Locker Kiosk</span>
          </div>
        </div>
        <dl className="tb-k-fields">
          <div className="tb-k-field">
            <dt>Lockers</dt>
            <dd>
              {String(free).padStart(2, "0")}/0{["1", "2", "3", "4"].length}
            </dd>
          </div>
          <div className="tb-k-field">
            <dt>Link</dt>
            <dd className={offline ? "state-bad" : "state-ok"}>
              <span className="tb-k-dot" />
              {offline ? "Down" : "Live"}
            </dd>
          </div>
          <div className="tb-k-field">
            <dt>Time</dt>
            <dd>
              {now.toLocaleTimeString("en-PH", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </dd>
          </div>
        </dl>
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

          <div className="qr-frame">
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

            {/* E4.2 — the code's remaining life, traced along its own border.
                A ring rather than a number because the mandate wants this
                legible across a corridor, and a depleting arc carries at a
                distance where 14px of monospace does not.

                Deliberately NOT urgent: one colour the whole way down, no
                escalation to amber or red, no pulse at the end. The person it
                serves is mid-decision about whether to pull their phone out
                now or wait two seconds for the next code, and a countdown
                that turns red teaches them the kiosk is about to punish them
                for being slow. It is not -- the code just rotates. */}
            {token && freshness !== null && (
              <svg className="qr-freshness" viewBox="0 0 100 100" aria-hidden="true">
                <rect className="qr-fresh-track" x="0" y="0" width="100" height="100" rx="1.5" />
                <rect
                  className="qr-fresh-arc"
                  x="0"
                  y="0"
                  width="100"
                  height="100"
                  rx="1.5"
                  pathLength={100}
                  style={{ strokeDashoffset: 100 - freshness * 100 }}
                />
              </svg>
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
          <p className="qr-refresh">
            {remaining === null
              ? "This code refreshes automatically for security"
              : remaining === 0
                ? "Fetching a fresh code…"
                : `This code refreshes in ${remaining}s`}
          </p>
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
