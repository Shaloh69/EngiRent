"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

/**
 * Block assembly — ported from the kiosk's transition system
 * (server/kiosk/kiosk_ui_react/src/components/BlockAssembly.tsx), retheme'd
 * onto this site's --brand-* tokens rather than the kiosk's --ink/--surf2
 * ones. Logic is unchanged; only the visual tokens and the boot card's copy
 * are local to this surface.
 *
 * Modular rectangular panels tile the screen completely, then the wall
 * clears to reveal the page beneath. Binary space partition (Mondrian-style
 * subdivision, not tetrominoes — see the kiosk component's own doc comment
 * for why tetrominoes were tried first and dropped) guarantees a gapless
 * tiling, so nothing shows through mid-transition.
 */

const COLS = 12;
const ROWS = 20;

// Pulled from this site's own --brand-* hex values (light mode) rather than
// hardcoding a separate palette — see styles/globals.css.
const COLORS = [
  "#0B5FA5", // brand-primary
  "#0A4E88", // deeper blue
  "#5FA0D2", // pale blue
  "#E9A13B", // brand-secondary
  "#083D6B", // deepest blue
  "#0B5FA5",
  "#EF6E7B", // brand-accent
  "#0A4E88",
];

const STAGGER_TOTAL = 1.05;
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
    if (depth > 5 || area <= 6 || (area < 16 && rand() < 0.45)) {
      out.push({ r, c, w, h });
      return;
    }
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

  const scored = out.map((p) => ({
    ...p,
    d:
      Math.abs(p.r + p.h / 2 - ROWS / 2) / ROWS +
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

const QUOTES = [
  { text: "Every build here is signed with the project's own release key.", attrib: "Security" },
  { text: "Rent and lend equipment, and open the smart locker from your phone.", attrib: "What this app does" },
  { text: "Payment is held in escrow — nobody hands over cash and hopes.", attrib: "How EngiRent works" },
  { text: "A locker holds the item, so the two students never have to meet.", attrib: "How EngiRent works" },
  { text: "The deposit comes back automatically once the item checks out.", attrib: "Your money" },
];

export type AssemblyPhase = "assembling" | "clearing" | "done";

interface Props {
  runKey: string | number;
  boot?: boolean;
  onFinished?: () => void;
}

export function BlockAssembly({ runKey, boot = false, onFinished }: Props) {
  const [phase, setPhase] = useState<AssemblyPhase>("assembling");
  const finished = useRef(false);

  const seed = useMemo(
    () => (Math.random() * 0xffffffff) >>> 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runKey],
  );
  const panels = useMemo(() => buildPanels(seed), [seed]);
  const stagger = STAGGER_TOTAL / Math.max(panels.length, 1);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const quote = useMemo(() => QUOTES[Math.floor(Math.random() * QUOTES.length)], [runKey]);

  const slideMs = 420;
  const buildMs = STAGGER_TOTAL * 1000 + slideMs;
  const holdMs = boot ? 1700 : 700;
  const assembleMs = buildMs + holdMs;
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

  const rotation = (p: Panel) =>
    ({
      top: { rotateX: 34, rotateY: 0 },
      bottom: { rotateX: -34, rotateY: 0 },
      left: { rotateX: 0, rotateY: -34 },
      right: { rotateX: 0, rotateY: 34 },
    })[p.from];

  return (
    <div className="asm-layer" aria-hidden>
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
              <p className="asm-sub">Preparing your download</p>
            </div>
          </div>
          <p className="asm-quote">{quote.text}</p>
          <p className="asm-attrib">{quote.attrib}</p>
        </motion.div>
      )}
    </div>
  );
}
