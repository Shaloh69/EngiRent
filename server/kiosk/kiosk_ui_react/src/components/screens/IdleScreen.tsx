import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AnimatedLock, type LockState } from "../AnimatedLock";
import { AuroraBackground } from "../AuroraBackground";

const SLIDE_MS = 4500;

interface Slide {
  eyebrow: string;
  title: string;
  subtitle: string;
  body: React.ReactNode;
}

const SLIDES: Slide[] = [
  {
    eyebrow: "University of Cebu Lapu-Lapu and Mandaue",
    title: "EngiRent Hub",
    subtitle: "Smart Equipment Rental System",
    body: <p className="idle-tagline">Engineering Thesis 2026</p>,
  },
  {
    eyebrow: "Place an Item",
    title: "Deposit Equipment",
    subtitle: "Securely for rental",
    body: (
      <ol className="idle-steps">
        <li>Open app → My Rentals → Place Item</li>
        <li>Scan kiosk QR with your phone</li>
        <li>Face check → locker opens</li>
      </ol>
    ),
  },
  {
    eyebrow: "Retrieve an Item",
    title: "Collect or Return",
    subtitle: "Rented equipment, quickly and safely",
    body: (
      <ol className="idle-steps">
        <li>Open app → My Rentals → Retrieve</li>
        <li>Scan kiosk QR with your phone</li>
        <li>Face recognition → locker opens</li>
      </ol>
    ),
  },
  {
    eyebrow: "AI-Verified Security",
    title: "Every Transaction Protected",
    subtitle: "By machine learning",
    body: (
      <div className="idle-badges">
        <span>✓ Face ID</span>
        <span>✓ QR Verified</span>
        <span>✓ ML Matched</span>
      </div>
    ),
  },
];

export function IdleScreen({ onTap }: { onTap: () => void }) {
  const [idx, setIdx] = useState(0);
  const [lockState, setLockState] = useState<LockState>("locked");

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % SLIDES.length), SLIDE_MS);
    return () => clearInterval(t);
  }, []);

  // Idle lock-animation loop: locked -> unlocking -> unlocked -> (repeat),
  // reinforcing "lock and key" + "rental" the way the design mandate asks
  // for on this screen specifically.
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

  const slide = SLIDES[idx];

  return (
    <div className="screen screen-idle" role="button" aria-label="Touch to start" onClick={onTap}>
      {/* Mandate §1.5 — the idle attract loop is the kiosk's showpiece screen
          and carries the full-bleed aurora. The Kiosk is deliberately excluded
          from §1.6's light/dark requirement: it is a fixed public display in
          one known lighting environment with no per-user preference to
          persist, and the permanently-dark "Vault" ground is what makes the
          lock and accents read from across a corridor.

          This runs on Raspberry Pi hardware this repo cannot currently reach
          to test, so the component's CSS-gradient fallback matters more here
          than anywhere else — if the Pi's WebGL context fails, the screen
          still shows a themed gradient rather than a black rectangle. */}
      <AuroraBackground
        colorStops={["#0D9488", "#F5A623", "#FB7185"]}
        amplitude={1.25}
        blend={0.5}
        speed={0.35}
        opacity={0.55}
      />
      <div className="idle-scrim" aria-hidden />

      <div className="idle-lock">
        <AnimatedLock state={lockState} size={100} />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={idx}
          className="idle-slide"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <p className="idle-eyebrow">{slide.eyebrow}</p>
          <h1 className="idle-title">{slide.title}</h1>
          <p className="idle-subtitle">{slide.subtitle}</p>
          <div className="idle-body">{slide.body}</div>
        </motion.div>
      </AnimatePresence>

      <div className="idle-dots">
        {SLIDES.map((_, i) => (
          <span key={i} className={`idle-dot ${i === idx ? "active" : ""}`} />
        ))}
      </div>

      <motion.div
        className="idle-cta"
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      >
        <span className="idle-cta-ring" />
        <p>Touch anywhere to start</p>
      </motion.div>
    </div>
  );
}
