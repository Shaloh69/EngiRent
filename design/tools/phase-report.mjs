/**
 * Phase progress report — `node design/tools/phase-report.mjs`
 *
 * Format borrowed from EcoCharge, at the user's request, and adapted to this
 * track: EngiRent's phases are E0-E7 and its checkbox convention has more than
 * two states.
 *
 * **It counts the phase files, nothing else.** That is deliberate. The number
 * is only worth looking at if it comes from the same artifact a reader can
 * open — a hand-maintained tally is exactly how E0 came to read "complete"
 * while sitting at 0 of 37 ticked (P-1). Under G9 the boxes are ticked as work
 * lands, so this report is now a live read rather than a summary of a summary.
 *
 * **Five states, not four**, because a box on this track is not binary and
 * flattening it would misreport:
 *
 *   done    - [x]
 *   prog    - [ ] whose note says it is partly delivered (HALF MET, one half
 *             shipped, and so on). Real work exists; the bullet is not met.
 *   BLOCK   - [ ] whose note names a blocker (the Pi, B-2, B-3...). NOT the
 *             same as todo: nobody can act on these without hardware.
 *   ruled   - [ ] deliberately not doing / deferred, carrying its ruling.
 *             Counting these as todo would inflate the work remaining;
 *             counting them as done would be a lie. They get their own column.
 *   todo    - everything else: genuinely outstanding, nobody has started it.
 *
 * The percentage is `done / (total - ruled)` — a decision the project has
 * already made once shouldn't sit in the denominator forever.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "docs/redesign/phases";

// Order matters: the first pattern that matches a box's note wins, so
// "blocked" beats "half met" (a half-done bullet nobody can finish is
// blocked, and reporting it as in-progress would overstate momentum).
const RULED = /\bRULED\b|deliberately not doing|defer(red)? to backlog/i;
const BLOCKED =
  /\bBLOCKED\b|Pi-blocked|kiosk-blocked|\(B-\d\)|B-2\b|B-3\b|offline/i;
const PROG =
  /HALF MET|partly delivered|PHONE HALF DONE|for the KIOSK|one half|in progress/i;

function classify(box) {
  if (box.checked) return "done";
  if (RULED.test(box.note)) return "ruled";
  if (BLOCKED.test(box.note)) return "blocked";
  if (PROG.test(box.note)) return "prog";
  return "todo";
}

/** A box is its own line plus every following indented continuation line —
 *  the note that says WHY it is open lives there, not on the `- [ ]` line. */
function parseBoxes(text) {
  const lines = text.split(/\r?\n/);
  const boxes = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*- \[([ xX])\]\s?(.*)$/);
    if (!m) continue;
    let note = m[2];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*- \[[ xX]\]/.test(lines[j])) break;
      if (!/^\s{2,}\S/.test(lines[j])) break;
      note += " " + lines[j].trim();
    }
    boxes.push({ checked: m[1] !== " ", note });
  }
  return boxes;
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".md"))
  .sort();

const rows = [];
const totals = { done: 0, prog: 0, todo: 0, blocked: 0, ruled: 0, all: 0 };

for (const f of files) {
  const boxes = parseBoxes(readFileSync(join(DIR, f), "utf8"));
  const c = { done: 0, prog: 0, todo: 0, blocked: 0, ruled: 0 };
  for (const b of boxes) c[classify(b)]++;
  const all = boxes.length;
  rows.push({ name: f.split("-")[0], c, all });
  for (const k of Object.keys(c)) totals[k] += c[k];
  totals.all += all;
}

const pad = (s, n) => String(s).padEnd(n);
const out = [];
for (const r of rows) {
  out.push(
    `Phase ${pad(r.name, 3)} done ${pad(r.c.done, 4)} prog ${pad(r.c.prog, 2)} ` +
      `todo ${pad(r.c.todo, 3)} BLOCKED ${pad(r.c.blocked, 2)} ` +
      `ruled ${pad(r.c.ruled, 2)} (${r.all})`,
  );
}
const denom = totals.all - totals.ruled;
const pct = denom > 0 ? Math.round((totals.done / denom) * 100) : 0;
out.push(
  `TOTAL    done ${pad(totals.done, 4)} prog ${pad(totals.prog, 2)} ` +
    `todo ${pad(totals.todo, 3)} BLOCKED ${pad(totals.blocked, 2)} ` +
    `ruled ${pad(totals.ruled, 2)} (${totals.all}) — ${pct}%`,
);

console.log(out.join("\n"));
console.log(
  `\n% is done/(total-ruled) = ${totals.done}/${denom}. ` +
    `BLOCKED needs hardware or a permission, not effort.`,
);
