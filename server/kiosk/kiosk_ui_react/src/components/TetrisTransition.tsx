import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

/**
 * Tetris assembly — the kiosk's signature loading and transition system.
 *
 * Tetromino pieces fall from above and stack until they have tiled the whole
 * screen; the completed wall then clears to reveal the page underneath. Every
 * screen change runs through it, so the kiosk has one recognisable motion
 * language instead of a generic cross-fade.
 *
 * Reference: the "Tetris loader" pattern (react + framer-motion) at
 * https://codesandbox.io/s/tetris-loader-2fhyf3, and the CSS-grid tetromino
 * layout at https://codepen.io/jh3y/pen/MQJBEN. Both animate pre-placed
 * pieces on a grid rather than simulating gravity, which is what makes the
 * timing repeatable — important here because this runs hundreds of times a
 * day on a fixed display and must look identical every time.
 *
 * Portrait-first: the grid is COLS wide and ROWS tall with ROWS > COLS, so
 * pieces fall the long axis of a vertical kiosk screen.
 */

const COLS = 6;
const ROWS = 10;

/** Standard tetrominoes, as [row, col] offsets from the piece origin. */
const SHAPES: Record<string, [number, number][]> = {
  I: [[0, 0], [0, 1], [0, 2], [0, 3]],
  O: [[0, 0], [0, 1], [1, 0], [1, 1]],
  T: [[0, 0], [0, 1], [0, 2], [1, 1]],
  L: [[0, 0], [1, 0], [2, 0], [2, 1]],
  J: [[0, 1], [1, 1], [2, 1], [2, 0]],
  S: [[0, 1], [0, 2], [1, 0], [1, 1]],
  Z: [[0, 0], [0, 1], [1, 1], [1, 2]],
};

/** Blueprint palette. Mostly blues, punctuated with brass and coral, so the
 *  wall reads as EngiRent rather than as generic Tetris. Five entries with a
 *  step of 2 below: 2 and 5 are coprime, so consecutive pieces never repeat a
 *  colour and the wall doesn't band into vertical stripes. */
const COLORS = [
  "#4DA3E8", // brand
  "#F5B85C", // brass
  "#2B7FD4", // deep blue
  "#FF8A95", // coral
  "#7FC4F0", // pale blue
];

interface Piece {
  id: number;
  cells: [number, number][];
  color: string;
  delay: number;
}

/**
 * Packs pieces into the grid bottom-up, choosing at each step a shape that
 * actually fits the current surface. Any leftover holes are filled with
 * single cells so the wall always completes — a half-tiled screen would
 * leave the page visible through the gaps mid-transition.
 *
 * Seeded and deterministic: same layout every run.
 */
function buildStack(seed: number): Piece[] {
  const grid: boolean[][] = Array.from({ length: ROWS }, () =>
    Array<boolean>(COLS).fill(false),
  );
  const pieces: Piece[] = [];
  const names = Object.keys(SHAPES);

  // Small deterministic PRNG (mulberry32) — no Math.random, so the animation
  // is byte-identical on every boot.
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const fits = (cells: [number, number][], r: number, c: number) =>
    cells.every(([dr, dc]) => {
      const rr = r + dr;
      const cc = c + dc;
      return rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && !grid[rr][cc];
    });

  let id = 0;
  let guard = 0;
  // Fill from the bottom row upward, left to right.
  for (let r = ROWS - 1; r >= 0; r--) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c]) continue;
      if (guard++ > 2000) break;

      // Try shapes in a rotating order so the wall isn't visibly patterned.
      const order = [...names].sort(() => rand() - 0.5);
      let placed = false;
      for (const name of order) {
        const cells = SHAPES[name];
        // Anchor so the shape's top-left lands at or above (r, c).
        const minRow = Math.min(...cells.map(([dr]) => dr));
        const originR = r - minRow;
        if (!fits(cells, originR, c)) continue;
        cells.forEach(([dr, dc]) => {
          grid[originR + dr][c + dc] = true;
        });
        pieces.push({
          id: id++,
          cells: cells.map(([dr, dc]) => [originR + dr, c + dc]),
          color: COLORS[(id * 2) % COLORS.length],
          delay: 0,
        });
        placed = true;
        break;
      }

      // No tetromino fits this pocket — plug it so the wall still completes.
      if (!placed) {
        grid[r][c] = true;
        pieces.push({
          id: id++,
          cells: [[r, c]],
          color: COLORS[(id * 2) % COLORS.length],
          delay: 0,
        });
      }
    }
  }

  // Stagger by stacking order: lower pieces land first, as gravity implies.
  const step = 0.9 / Math.max(pieces.length, 1);
  pieces.forEach((p, i) => {
    p.delay = i * step;
  });

  return pieces;
}

export type TetrisPhase = "assembling" | "clearing" | "done";

interface Props {
  /** Changing this restarts the animation — pass the screen key. */
  runKey: string | number;
  /** Longer, full-logo version used once at boot. */
  boot?: boolean;
  /** Fired when the wall has cleared and the page below is fully visible. */
  onFinished?: () => void;
}

export function TetrisTransition({ runKey, boot = false, onFinished }: Props) {
  const [phase, setPhase] = useState<TetrisPhase>("assembling");
  const finished = useRef(false);

  // Seed from the run key so each screen gets its own stable arrangement:
  // recognisably the same effect, never a literal repeat.
  const seed = useMemo(() => {
    const str = String(runKey);
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }, [runKey]);

  const pieces = useMemo(() => buildStack(seed), [seed]);

  const fallMs = 340;
  const assembleMs = 900 + fallMs + (boot ? 700 : 0);
  const clearMs = 620;

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

  return (
    <div className="tetris-layer" aria-hidden>
      <div
        className="tetris-grid"
        style={{
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gridTemplateRows: `repeat(${ROWS}, 1fr)`,
        }}
      >
        {pieces.map((piece) =>
          piece.cells.map(([r, c], ci) => (
            <motion.span
              key={`${piece.id}-${ci}`}
              className="tetris-cell"
              style={{
                gridRow: r + 1,
                gridColumn: c + 1,
                background: piece.color,
              }}
              initial={{ y: "-115vh", opacity: 1 }}
              animate={
                clearing
                  ? {
                      // Rows clear downward-and-out, the way a completed line
                      // does in the game.
                      y: "115vh",
                      opacity: 0,
                      transition: {
                        duration: 0.5,
                        delay: (ROWS - r) * 0.028,
                        ease: [0.4, 0, 0.9, 0.4],
                      },
                    }
                  : {
                      y: 0,
                      transition: {
                        duration: fallMs / 1000,
                        delay: piece.delay,
                        ease: [0.33, 0, 0.2, 1],
                      },
                    }
              }
            />
          )),
        )}
      </div>

      {boot && (
        <motion.div
          className="tetris-boot-brand"
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{
            opacity: clearing ? 0 : 1,
            scale: 1,
            transition: { duration: 0.45, delay: clearing ? 0 : 0.95 },
          }}
        >
          <div className="tetris-boot-mark">ER</div>
          <p className="tetris-boot-name">EngiRent Hub</p>
          <p className="tetris-boot-sub">Smart Locker Kiosk</p>
        </motion.div>
      )}
    </div>
  );
}
