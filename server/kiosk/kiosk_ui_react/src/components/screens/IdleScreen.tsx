import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AnimatedLock, type LockState } from "../AnimatedLock";
import { AuroraBackground } from "../AuroraBackground";

/**
 * Idle attract loop — mandate §4.
 *
 * Rebuilt from scratch. The previous version cycled four thin slides that
 * repeated the product name and little else; someone walking past learned
 * that a box called EngiRent existed and nothing about what it does or how
 * to use it.
 *
 * This is now the kiosk's promotional surface, carrying the same story as
 * client/web: the hero line, the six-stage lifecycle, the three things that
 * make it safer than a cash handover, and — the piece that was missing
 * entirely — step-by-step directions for using the machine in front of you.
 *
 * Kiosk-industry guidance is explicit that the attract loop should be the
 * most visually energetic screen and must carry an unmissable touch cue,
 * because a static touchscreen doesn't read as touchable to a passer-by.
 * (kioskindustry.org UX checklist)
 */

const SLIDE_MS = 7000;

type Scene =
  | { kind: "hero" }
  | { kind: "steps"; eyebrow: string; title: string; steps: { n: string; label: string; body: string }[] }
  | { kind: "compare"; eyebrow: string; title: string; rows: { without: string; with: string }[] }
  | { kind: "directions" };

/** Lifted from client/web's homepage so the kiosk and the site tell one
 *  story. If the site's copy changes, this is the thing to re-check. */
const SCENES: Scene[] = [
  { kind: "hero" },
  {
    kind: "steps",
    eyebrow: "How it works",
    title: "Six steps, one controlled lifecycle",
    steps: [
      { n: "01", label: "List", body: "A student lists gear they own — calculators, Arduino kits, lab gowns — with a daily rate and deposit." },
      { n: "02", label: "Book & pay", body: "The renter books dates and pays. Fee and refundable deposit are both held before anything moves." },
      { n: "03", label: "Deposit at the kiosk", body: "The owner drops the item into a smart locker. Cameras capture its condition on the way in." },
      { n: "04", label: "AI condition check", body: "An 8-stage computer-vision pipeline compares deposit and return images and scores the match." },
      { n: "05", label: "Unlock", body: "The renter opens the locker with a short-lived QR token plus face verification. No staff needed." },
      { n: "06", label: "Return & settle", body: "The deposit is refunded net of any late or damage fees, and the owner gets paid out." },
    ],
  },
  {
    kind: "compare",
    eyebrow: "Why a locker",
    title: "What this replaces",
    rows: [
      {
        without: "Hand over cash and hope. Whoever moves first carries the risk.",
        with: "Payment is escrowed and only released once the item is verifiably deposited.",
      },
      {
        without: "Meet up, coordinate schedules, and trust the other person showed up with the right thing.",
        with: "A locker holds the item. Short-lived QR tokens and face checks gate every door action.",
      },
      {
        without: "One person's memory against another's, with no record of the item's prior condition.",
        with: "Both handovers are photographed, and an AI condition check flags the difference.",
      },
    ],
  },
  { kind: "directions" },
];

/** The directions scene is its own type because it's the one thing on this
 *  loop that is about *this machine* rather than the service. */
const DIRECTIONS = [
  {
    n: "1",
    title: "Touch the screen",
    body: "Anywhere. That wakes the kiosk and brings up the session code.",
  },
  {
    n: "2",
    title: "Open EngiRent on your phone",
    body: "Go to My Rentals and pick the rental you came here for.",
  },
  {
    n: "3",
    title: "Tap Place, Collect or Return",
    body: "Your phone will open its camera ready to scan.",
  },
  {
    n: "4",
    title: "Scan the code on this screen",
    body: "The kiosk and your phone pair instantly. The code rotates for security.",
  },
  {
    n: "5",
    title: "Look at the camera above",
    body: "A quick face check confirms it's you. Remove hats and sunglasses.",
  },
  {
    n: "6",
    title: "Your locker opens",
    body: "Take or place your item, then close the door. That's it.",
  },
];

export function IdleScreen({ onTap }: { onTap: () => void }) {
  const [idx, setIdx] = useState(0);
  const [lockState, setLockState] = useState<LockState>("locked");

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % SCENES.length), SLIDE_MS);
    return () => clearInterval(t);
  }, []);

  // Lock loop: locked -> unlocking -> unlocked -> ..., reinforcing "lock and
  // key" + "rental" the way §4 asks for on this screen specifically.
  useEffect(() => {
    const cycle = [
      ["locked", 1800],
      ["unlocking", 900],
      ["unlocked", 1800],
      ["unlocking", 900],
    ] as [LockState, number][];
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const step = () => {
      setLockState(cycle[i][0]);
      t = setTimeout(() => {
        i = (i + 1) % cycle.length;
        step();
      }, cycle[i][1]);
    };
    step();
    return () => clearTimeout(t);
  }, []);

  const scene = SCENES[idx];

  return (
    <div className="screen screen-idle" role="button" aria-label="Touch to start" onClick={onTap}>
      {/* Mandate §1.5 — the attract loop is the kiosk's showpiece and carries
          the full-bleed aurora. This runs on Raspberry Pi hardware this repo
          cannot currently reach to test, so the component's CSS-gradient
          fallback matters more here than anywhere else: if the Pi's WebGL
          context fails, the screen still shows a themed gradient rather than
          a black rectangle. */}
      <AuroraBackground
        colorStops={["#4DA3E8", "#F5B85C", "#FF8A95"]}
        amplitude={1.25}
        blend={0.5}
        speed={0.35}
        opacity={0.55}
      />
      <div className="idle-scrim" aria-hidden />

      <header className="idle-head">
        <div className="idle-mark">ER</div>
        <div className="idle-mark-text">
          <span className="idle-mark-name">EngiRent Hub</span>
          <span className="idle-mark-sub">UCLM · Smart Locker Kiosk</span>
        </div>
        <div className="idle-lock-mini">
          <AnimatedLock state={lockState} size={54} />
        </div>
      </header>

      <div className="idle-stage">
        {/* D-52: this was AnimatePresence mode="wait". "wait" holds the
            incoming scene until the outgoing one has fully left, so for ~0.55s
            of every 7s cycle the stage rendered NOTHING — a full-panel blank
            that reads as a flicker on a 1080x1920 wall display. Default
            (sync) mode overlaps them into a real crossfade; .idle-scene is
            absolutely positioned in screens.css so the two can occupy the
            same box instead of stacking and shoving the layout. */}
        <AnimatePresence>
          <motion.div
            key={idx}
            className="idle-scene"
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -22 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          >
            {scene.kind === "hero" && <HeroScene lockState={lockState} />}
            {scene.kind === "steps" && <StepsScene scene={scene} />}
            {scene.kind === "compare" && <CompareScene scene={scene} />}
            {scene.kind === "directions" && <DirectionsScene />}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="idle-dots">
        {SCENES.map((_, i) => (
          <span key={i} className={`idle-dot ${i === idx ? "active" : ""}`}>
            {i === idx && (
              <motion.span
                className="idle-dot-fill"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: SLIDE_MS / 1000, ease: "linear" }}
              />
            )}
          </span>
        ))}
      </div>

      <motion.div
        className="idle-cta"
        animate={{ scale: [1, 1.04, 1] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      >
        <span className="idle-cta-hand" aria-hidden>
          <span className="idle-cta-ring" />
          <motion.svg
            width="34"
            height="34"
            viewBox="0 0 24 24"
            fill="none"
            animate={{ y: [0, -7, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          >
            <path
              d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V12m0-1a1.5 1.5 0 0 1 3 0v5a5 5 0 0 1-5 5h-1.5a5.5 5.5 0 0 1-4.6-2.5L5 15.5a1.6 1.6 0 0 1 2.4-2L9 15"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.svg>
        </span>
        <p>Touch anywhere to start</p>
      </motion.div>
    </div>
  );
}

function HeroScene({ lockState }: { lockState: LockState }) {
  return (
    <div className="idle-hero">
      <div className="idle-hero-lock">
        <AnimatedLock state={lockState} size={150} />
      </div>
      <p className="idle-eyebrow">UCLM Engineering Thesis Platform</p>
      <h1 className="idle-title">
        Student gear,{" "}
        <span className="idle-title-accent">rented safely</span> through a smart
        locker.
      </h1>
      <p className="idle-lede">
        Borrow the calculator, Arduino kit or lab gown you need for one subject
        instead of buying it. Payment is held in escrow, the handover happens
        through this locker, and an AI condition check settles it.
      </p>
      <div className="idle-badges">
        <span>Escrowed payment</span>
        <span>Face-verified access</span>
        <span>AI condition check</span>
      </div>
    </div>
  );
}

function StepsScene({ scene }: { scene: Extract<Scene, { kind: "steps" }> }) {
  return (
    <div className="idle-block">
      <p className="idle-eyebrow">{scene.eyebrow}</p>
      <h2 className="idle-h2">{scene.title}</h2>
      <ol className="idle-steps">
        {scene.steps.map((s, i) => (
          <motion.li
            key={s.n}
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.09, duration: 0.4 }}
          >
            <span className="idle-step-n">{s.n}</span>
            <span className="idle-step-text">
              <strong>{s.label}</strong>
              {s.body}
            </span>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

function CompareScene({ scene }: { scene: Extract<Scene, { kind: "compare" }> }) {
  return (
    <div className="idle-block">
      <p className="idle-eyebrow">{scene.eyebrow}</p>
      <h2 className="idle-h2">{scene.title}</h2>
      <div className="idle-compare">
        {scene.rows.map((r, i) => (
          <motion.div
            key={i}
            className="idle-compare-row"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 + i * 0.13, duration: 0.42 }}
          >
            <div className="idle-compare-cell without">
              <span className="idle-compare-tag">Without</span>
              <p>{r.without}</p>
            </div>
            <div className="idle-compare-cell with">
              <span className="idle-compare-tag">With EngiRent</span>
              <p>{r.with}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function DirectionsScene() {
  return (
    <div className="idle-block">
      <p className="idle-eyebrow">Using this kiosk</p>
      <h2 className="idle-h2">Six steps, about a minute</h2>
      <div className="idle-directions">
        {DIRECTIONS.map((d, i) => (
          <motion.div
            key={d.n}
            className="idle-direction"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.08 + i * 0.08, duration: 0.36 }}
          >
            <span className="idle-direction-n">{d.n}</span>
            <div>
              <p className="idle-direction-title">{d.title}</p>
              <p className="idle-direction-body">{d.body}</p>
            </div>
          </motion.div>
        ))}
      </div>
      <p className="idle-directions-foot">
        Don't have the app yet? It's a free download — ask any Engineering
        student or scan the code on the next screen.
      </p>
    </div>
  );
}
