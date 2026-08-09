import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

/**
 * Block assembly — the kiosk's loading and transition system.
 *
 * Modular rectangular panels slide in and tile the screen completely, then the
 * wall clears to reveal the page beneath. Every screen change runs through it,
 * so the kiosk has one recognisable motion language instead of a cross-fade.
 *
 * WHY NOT TETROMINOES. The first version used the seven standard Tetris
 * pieces, which read as a video game rather than as a piece of engineering
 * equipment — wrong register for a locker terminal in an Engineering
 * building. This uses Mondrian-style subdivision instead: varied rectangles
 * on a grid, which reads as architectural drawing and matches the Blueprint
 * palette. References:
 * - https://codepen.io/vinvanbreugel/pen/pmzmmb (Mondrian generator, CSS Grid)
 * - https://codepen.io/nicksands/pen/LYEmbgb (random Mondrian, CSS Grid)
 * - https://codepen.io/wescouch/pen/OYYpWN (pure-CSS block preloader)
 *
 * The subdivision also fixes a real bug in the tetromino version: that one
 * packed pieces greedily and left pockets, and the grid's 2px gaps let the
 * page show through the wall mid-transition. Binary subdivision partitions
 * the rectangle *exhaustively* — every cell belongs to exactly one panel, so
 * there is nothing to see through. An opaque backdrop underneath makes that
 * guarantee belt-and-braces.
 *
 * Layout and quote are both re-rolled on every run, so no two loads look the
 * same.
 */

const COLS = 12;
const ROWS = 20;

/** Blueprint palette. Mostly blues with brass and coral punctuation, so the
 *  wall reads as EngiRent. Weighted: blues dominate. */
const COLORS = [
  "#4DA3E8", // brand
  "#2B7FD4", // deep blue
  "#7FC4F0", // pale blue
  "#F5B85C", // brass
  "#1E5F9E", // deeper blue
  "#4DA3E8",
  "#FF8A95", // coral
  "#2B7FD4",
];

/** Total stagger window, shared by the build and the mirrored teardown. */
const STAGGER_TOTAL = 1.05;

/** Entrance easing, and its exact mirror for the exit.
 *  Reversing cubic-bezier(x1,y1,x2,y2) gives (1-x2, 1-y2, 1-x1, 1-y1). */
const EASE_IN: [number, number, number, number] = [0.22, 1, 0.28, 1];
const EASE_OUT: [number, number, number, number] = [0.72, 0, 0.78, 0];

interface Panel {
  id: number;
  r: number;
  c: number;
  w: number;
  h: number;
  color: string;
  delay: number;
  from: "top" | "bottom" | "left" | "right";
}

/**
 * Binary space partition of the grid — the standard Mondrian approach.
 * Recursively splits a rectangle along its longer axis until the pieces fall
 * under a size threshold. Guarantees a complete, gapless tiling.
 */
function buildPanels(seed: number): Panel[] {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const out: { r: number; c: number; w: number; h: number }[] = [];

  const split = (r: number, c: number, w: number, h: number, depth: number) => {
    const area = w * h;
    // Stop subdividing once a panel is small enough, with a little randomness
    // so the wall isn't uniformly sized.
    if (depth > 5 || area <= 6 || (area < 16 && rand() < 0.45)) {
      out.push({ r, c, w, h });
      return;
    }

    // Split the longer axis, biased to keep panels from becoming slivers.
    const vertical = w > h || (w === h && rand() < 0.5);
    if (vertical && w >= 2) {
      const cut = 1 + Math.floor(rand() * (w - 1));
      split(r, c, cut, h, depth + 1);
      split(r, c + cut, w - cut, h, depth + 1);
    } else if (h >= 2) {
      const cut = 1 + Math.floor(rand() * (h - 1));
      split(r, c, w, cut, depth + 1);
      split(r + cut, c, w, h - cut, depth + 1);
    } else {
      out.push({ r, c, w, h });
    }
  };

  split(0, 0, COLS, ROWS, 0);

  // Order by distance from the vertical centre line so the wall closes inward
  // toward the card, rather than sweeping across in one direction.
  const scored = out.map((p) => ({
    ...p,
    d: Math.abs(p.r + p.h / 2 - ROWS / 2) / ROWS +
      Math.abs(p.c + p.w / 2 - COLS / 2) / COLS,
  }));
  scored.sort((a, b) => b.d - a.d);

  const step = STAGGER_TOTAL / Math.max(scored.length, 1);
  return scored.map((p, i) => ({
    id: i,
    r: p.r,
    c: p.c,
    w: p.w,
    h: p.h,
    // Step 3 against 8 colours: coprime, so neighbours never share a colour
    // and the wall doesn't band. (The tetromino version banded into stripes
    // because its step shared a factor with the palette length.)
    color: COLORS[(i * 3) % COLORS.length],
    delay: i * step,
    from:
      p.c + p.w / 2 < COLS / 2
        ? "left"
        : p.c + p.w / 2 > COLS / 2
          ? "right"
          : p.r + p.h / 2 < ROWS / 2
            ? "top"
            : "bottom",
  }));
}

/** Rotating lines shown on the boot card. Short enough to read in the second
 *  and a half the card is on screen. */
const QUOTES: { text: string; attrib: string }[] = [
  {
    text: "Payment is held in escrow — nobody hands over cash and hopes.",
    attrib: "How EngiRent works",
  },
  {
    text: "A locker holds the item, so the two students never have to meet.",
    attrib: "How EngiRent works",
  },
  {
    text: "Both handovers are photographed. An AI condition check settles the difference.",
    attrib: "How EngiRent works",
  },
  {
    text: "Short-lived QR tokens and a face check gate every door action.",
    attrib: "Security",
  },
  {
    text: "Borrow the kit you need for one subject instead of buying it.",
    attrib: "Why students use it",
  },
  {
    text: "The deposit comes back automatically once the item checks out.",
    attrib: "Your money",
  },
  {
    text: "Calculators, Arduino kits, lab gowns, measuring tools.",
    attrib: "What's on the shelf",
  },
  {
    text: "Every locker action is written to an audit trail.",
    attrib: "Accountability",
  },
];

const LAST_QUOTE_KEY = "engirent_kiosk_last_quote";

/** Remembers the previous pick so the same line never shows twice running.
 *
 *  Persisted rather than held in a module variable. A module variable dies
 *  with the JS context, so it only prevented repeats *within* one page
 *  session — verification caught the quote repeating back-to-back across
 *  reloads, which is exactly the case that matters on a kiosk that reloads
 *  and reboots. */
function readLastQuote(): number {
  try {
    const v = window.localStorage.getItem(LAST_QUOTE_KEY);
    return v === null ? -1 : Number.parseInt(v, 10);
  } catch {
    // Private mode / storage disabled — degrade to allowing a repeat rather
    // than breaking the boot screen.
    return -1;
  }
}

function writeLastQuote(i: number): void {
  try {
    window.localStorage.setItem(LAST_QUOTE_KEY, String(i));
  } catch {
    /* no-op */
  }
}

function pickQuoteIndex(): number {
  if (QUOTES.length < 2) return 0;
  const last = readLastQuote();
  let i = last;
  while (i === last) {
    i = Math.floor(Math.random() * QUOTES.length);
  }
  writeLastQuote(i);
  return i;
}

export type AssemblyPhase = "assembling" | "clearing" | "done";

interface Props {
  /** Changing this restarts the animation — pass the screen key. */
  runKey: string | number;
  /** Longer version with the wordmark and a rotating quote; used at boot. */
  boot?: boolean;
  /** Fired when the wall has cleared and the page below is fully visible. */
  onFinished?: () => void;
}

export function BlockAssembly({ runKey, boot = false, onFinished }: Props) {
  const [phase, setPhase] = useState<AssemblyPhase>("assembling");
  const finished = useRef(false);

  // A fresh seed per run, so the wall is laid out differently every reload and
  // every screen change. `useMemo` keyed on runKey means it is drawn once per
  // run and stays stable while that run animates — re-rolling on each render
  // would make panels jump mid-slide.
  //
  // This was deterministic at first, on the reasoning that a fixed display
  // running the same animation hundreds of times a day should look identical
  // every time. Reversed on review: nothing functional depends on the layout,
  // and on an attract-loop screen variety is worth more than repeatability.
  const seed = useMemo(
    () => (Math.random() * 0xffffffff) >>> 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runKey],
  );

  const panels = useMemo(() => buildPanels(seed), [seed]);
  const stagger = STAGGER_TOTAL / Math.max(panels.length, 1);

  // Random per run, and never the same line twice in a row — a repeat reads as
  // a bug rather than as chance.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const quote = useMemo(() => QUOTES[pickQuoteIndex()], [runKey]);

  const slideMs = 420;
  // Total time for the wall to finish building: last panel's delay + its slide.
  const buildMs = STAGGER_TOTAL * 1000 + slideMs;
  // Hold once complete. Longer at boot so the quote can actually be read.
  const holdMs = boot ? 1700 : 700;
  const assembleMs = buildMs + holdMs;
  // The exit mirrors the entrance exactly — same stagger, same slide, run
  // backwards — so it takes exactly as long as the build did.
  const clearMs = buildMs;

  useEffect(() => {
    finished.current = false;
    setPhase("assembling");
    const t1 = setTimeout(() => setPhase("clearing"), assembleMs);
    const t2 = setTimeout(() => {
      setPhase("done");
      if (!finished.current) {
        finished.current = true;
        onFinished?.();
      }
    }, assembleMs + clearMs);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // onFinished is intentionally excluded: callers pass an inline closure and
    // re-running this on every parent render would restart the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, assembleMs, clearMs, boot]);

  if (phase === "done") return null;

  const clearing = phase === "clearing";

  const offset = (p: Panel) =>
    ({
      top: { y: "-120vh", x: 0 },
      bottom: { y: "120vh", x: 0 },
      left: { x: "-120vw", y: 0 },
      right: { x: "120vw", y: 0 },
    })[p.from];

  // Panels tilt away from the viewer on the axis they travel along, so they
  // read as physical slabs swinging into place rather than flat rectangles
  // sliding. Reused verbatim by the exit, which is what makes the two mirror.
  const rotation = (p: Panel) =>
    ({
      top: { rotateX: 34, rotateY: 0 },
      bottom: { rotateX: -34, rotateY: 0 },
      left: { rotateX: 0, rotateY: -34 },
      right: { rotateX: 0, rotateY: 34 },
    })[p.from];

  return (
    <div className="asm-layer" aria-hidden>
      {/* Opaque ground. The tetromino version relied on the panels themselves
          to hide the page, and its 2px grid gaps let the page show through.
          This makes covering the page structural rather than incidental. */}
      <motion.div
        className="asm-backdrop"
        initial={{ opacity: 0 }}
        animate={{
          opacity: clearing ? 0 : 1,
          transition: { duration: clearing ? 0.45 : 0.18, delay: clearing ? 0.3 : 0 },
        }}
      />

      <div
        className="asm-grid"
        style={{
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gridTemplateRows: `repeat(${ROWS}, 1fr)`,
        }}
      >
        {panels.map((p) => (
          <motion.span
            key={p.id}
            className="asm-panel"
            style={{
              gridRow: `${p.r + 1} / span ${p.h}`,
              gridColumn: `${p.c + 1} / span ${p.w}`,
              background: p.color,
              transformPerspective: 1400,
            }}
            initial={{ ...offset(p), ...rotation(p), opacity: 1 }}
            animate={
              clearing
                ? {
                    // Exactly the entrance, played backwards: each panel
                    // retreats the way it arrived, the stagger runs in
                    // reverse order (last in, first out), and the easing is
                    // the mirror of EASE_IN — so the wall unbuilds itself
                    // rather than being swept away by a different animation.
                    ...offset(p),
                    ...rotation(p),
                    transition: {
                      duration: slideMs / 1000,
                      delay: (panels.length - 1 - p.id) * stagger,
                      ease: EASE_OUT,
                    },
                  }
                : {
                    x: 0,
                    y: 0,
                    rotateX: 0,
                    rotateY: 0,
                    transition: {
                      duration: slideMs / 1000,
                      delay: p.delay,
                      ease: EASE_IN,
                    },
                  }
            }
          />
        ))}
      </div>

      {boot && (
        <motion.div
          className="asm-card"
          initial={{ opacity: 0, y: 12 }}
          animate={{
            opacity: clearing ? 0 : 1,
            y: clearing ? -8 : 0,
            transition: { duration: 0.4, delay: clearing ? 0 : 1.25 },
          }}
        >
          <div className="asm-card-head">
            <div className="asm-mark">ER</div>
            <div>
              <p className="asm-name">EngiRent Hub</p>
              <p className="asm-sub">Smart Locker Kiosk</p>
            </div>
          </div>
          <p className="asm-quote">{quote.text}</p>
          <p className="asm-attrib">{quote.attrib}</p>
        </motion.div>
      )}
    </div>
  );
}
