# CLAUDE-CODE-PLAYBOOK.md — Practices, Prompt Templates, Task Handling

Adapted from Anthropic's own Claude Code guidance
(`code.claude.com/docs/en/best-practices`) to this project's specific
realities: four surfaces, near-zero existing test coverage, real hardware, and
a track that will not fit in one context window.

---

## 1. The loop: Explore → Plan → Implement → Verify

**Explore.** Read before writing. For a screen: its template row, its
endpoints, the existing implementation. Don't start editing to find out what's
there.

**Plan.** For anything touching more than one file, state the plan in the
response before editing. Cheap to correct a plan; expensive to correct four
files.

**Implement.** Small, verifiable commits — one logical change each, message
says what and why.

**Verify.** This project has been bitten three times by code that compiled,
passed tests, and was broken on screen (the 3D layer not reading tokens,
seeded palettes rendering identically, a blank route from a hooks-order bug).
**"Typecheck clean, tests green" is necessary and nowhere near sufficient.**
Open the thing. Screenshot it. Look.

---

## 2. Context management

An 8-phase track across four surfaces will not fit one context window.
Clearing is expected and correct; losing the thread is not.

- **Before any `/clear` or session end:** update `docs/PROGRESS.md` — current
  phase, register deltas, blockers, next concrete step, in enough detail that
  a version of you with no memory could resume correctly
- **Starting a session:** read `CLAUDE.md` → `ENGIRENT-CLAUDE.md` →
  `docs/PROGRESS.md` → the current phase file. Resume from "next concrete
  step." Don't re-read all nine docs every session
- **One phase per session** is the target cadence. E5 (Flutter, ~27 screens)
  and E6 (admin, 18 pages) will need several — split by surface section, not
  by "how much context is left"
- **Self-diagnose:** if you're re-deriving something you already worked out
  earlier in the session, context is full. Say so, update PROGRESS, clear

### 2b. Context degradation — how to notice it and what to do

Quality degrades *before* you hit a hard limit, and it degrades quietly. The
failure isn't "I ran out of room" — it's confidently doing slightly worse
work while feeling fine. Watch for these specific symptoms in your own output:

**Early warning signs, roughly in the order they appear:**
1. **Re-deriving a decision already made** this session — re-checking which
   template a screen uses, re-reading an endpoint you already read
2. **Summaries getting vaguer** — "updated the component" instead of naming
   what changed and why
3. **Losing the rules** — forgetting the status line, skipping a screenshot,
   forgetting that PENDING isn't red, not updating the register
4. **Drifting toward agreement** — accepting the docs' claims without checking
   them against the repo, when earlier in the session you were catching errors
5. **Batching** — doing four screens at once "to save time" when the process
   is explicitly one at a time. This one is the most dangerous because it
   feels like efficiency
6. **Skipping verification** — reasoning that a change is obviously fine
   rather than opening the page. This project has been bitten three times
   exactly this way

**What to do, in order of preference:**

- **Best: finish the current unit of work, then clear.** Complete the screen
  or section you're on — never clear mid-screen, that's how half-built work
  gets lost. Update `docs/PROGRESS.md` fully. `/clear`. Reload from
  `CLAUDE.md` → `ENGIRENT-CLAUDE.md` → `docs/PROGRESS.md` → current phase file.
- **Say it out loud to the human.** "I'm noticing symptom 3 — I skipped the
  status line twice. Updating PROGRESS and clearing." That's useful
  information, not an admission of failure. The human can't see your context
  fill from their side.
- **Write more into PROGRESS than feels necessary before clearing.** The
  version of you that resumes has zero memory of this session's reasoning.
  Decisions, dead ends already ruled out, and the *why* behind the next step
  all matter — not just the checklist state.
- **Plan clears around natural boundaries.** End of a phase section, end of a
  surface, end of a screen. Never mid-defect, mid-screen, or mid-migration.

**What not to do:**
- Don't push through to "finish this phase first" — a degraded phase-end is
  worse than a clean mid-phase break with good notes
- Don't compress by dropping the verification steps; that's exactly the work
  degradation is most likely to make you skip
- Don't re-read all nine documents after a clear. Read the four in the
  resume order above. Re-reading everything is itself a context-filling
  mistake

**Structural defence, already built into this track:** `docs/PROGRESS.md`'s
three registers exist precisely so continuity doesn't live in conversation
history. If the registers are current, a clear costs you almost nothing. If
they're stale, a clear costs you the session. **Keeping them current is the
context-management strategy** — everything else is just noticing when to use it.

---

## 3. Task handling

**Subagents** — use for genuinely parallel *read-only* work: auditing socket
consumers across four surfaces, enumerating endpoints, sweeping for a bug
pattern. **Never** for parallel writes to the same files.

**Test-first where there's a correct answer** — especially E1's self-action
rejections. **Watch them fail before you fix them.** A test that never failed
proves nothing, which is exactly why D-3 (renting your own item) shipped.

**Diff, not file** — on anything touching several screens, show the diff.

**The repo wins over the docs.** These nine documents were written from an
audit plus a defect report, not from running the product. When they conflict
with the code, flag it, fix the doc, then proceed.

**Ask when the answer changes hours of work.** Not for routine implementation
choices — for the open decisions listed in `docs/PROGRESS.md` (localization
ruling, dead-code deletion, push notifications scope, which
`CAPABILITY-GAPS.md` items to build).

---

## 4. Prompt templates, per phase

Use these as the *second* message in a session, after the read-and-confirm
step from `KICKOFF_PROMPT.md` (first session) or after reading PROGRESS
(later sessions).

### Starting any phase N
```
Read docs/redesign/phases/E<N>-*.md and docs/PROGRESS.md.

Open with the status line, then: restate this phase's goal in your own words,
list its sections, and tell me which register rows it should move and roughly
how many. If the phase file conflicts with what's actually in the repo, say so
now rather than working around it silently.

Then work the phase's sections in order. **Don't stop between sections to
report** — put findings in docs/PROGRESS.md as you go and keep moving. Surface
something only if it meets the bar in ENDGOAL-AND-TRACKING.md §2 ("When to
surface something"): blocked, needs my ruling, a security finding, context
filling, an irreversible action, a correction to something you already told me,
or the phase is done.
```

### Resuming mid-phase
```
Read docs/PROGRESS.md and the current phase file. Open with the status line,
confirm the "next concrete step" is still correct given what's in the repo,
then continue from there. Don't re-do completed sections — check the register
first.
```

### Per-screen work (E5, E6, E7)
```
Screen: <name>. Before writing any UI code:
1. Quote its row from TEMPLATE-LINKS.md. No row → write one first (or
   BESPOKE + pattern ref + justification, all three).
2. Confirm the template screenshot exists at design/templates/<surface>-<slug>.png.
   If not, capture it now.
3. Name the endpoints this screen consumes, from Implemented.md §3.1.
4. Name which E3 tokens and shared components it uses — no local
   reimplementations.

Then build. At PASS:
5. Capture the AFTER image at both viewports into design/after/.
6. Generate the template|before|after triptych into design/comparisons/.
7. Fill in the conformance note — LAYOUT, UI, WIDGETS, SPRITES, DEVIATED —
   per VISUAL-EVIDENCE.md §3. Name what you took from the template, what you
   replaced with a shared component, what you dropped and why.
8. Update the screen register with PASS or FAILED + reason.

A screen with all three images and no conformance note is FAILED — the images
prove a comparison was possible, the note proves one happened.
```

### Defect work (E2)
```
Defect: <D-N>. Before fixing:
1. Reproduce it in the running system and describe what you actually saw.
2. Confirm or correct DEFECTS-AND-GAPS.md's analysis — it was written from the
   API surface, not from reading the failing code.
3. Write a failing test first. Show me it failing.
Then fix, show the test passing, and update the defect register.
**Verify it on screen before calling it fixed** — a green test is not a fix.
Work straight through the defect list; report per ENDGOAL-AND-TRACKING.md §2,
not per defect.
```

### End-of-phase checkpoint
```
Phase complete? Report:
- Status line
- What you actually RAN vs. what you inspected
- Register deltas: what moved to PASS, what's still FAILED and why
- Open decisions needing my ruling
- First thing phase <N+1> will do
- Any context-degradation symptoms you noticed in yourself this session (§2b)

Then update docs/PROGRESS.md fully. Don't start the next phase in this session.
```

### When something looks wrong in the docs
```
You've flagged a conflict between the docs and the repo. Before changing
either: show me the specific lines in both, say which you think is right and
why, and propose the doc edit. Don't work around it silently and don't edit
the doc without showing me the conflict first.
```

---

## 5. Hard rules for this track

1. **No screen ships without a template row and a screenshot pair.** `FAILED`
   is a real status that gets recorded, not a thing to avoid by lowering the bar
2. **Never change `kiosk_config.json`'s hand-calibrated timings.** If an
   animation and a timing value disagree, the hardware is right
3. **Security findings get fixed immediately and reported** — not filed as
   backlog (`ML_API_KEY` fail-open, dlib fallback)
4. **Server-side stays authoritative.** Client-side role gating is a UX fix
   and must never be described as a security boundary
5. **Predated docs get moved and bannered, never deleted**
6. **Every response opens with the status line** (`ENDGOAL-AND-TRACKING.md` §2).
   One line, always — it is not a report and needs no prose around it
7. **Default to continuing, not reporting.** `docs/PROGRESS.md` is the running
   record; interrupt the human only for the reasons in
   `ENDGOAL-AND-TRACKING.md` §2 — blocked, a ruling needed, a security finding,
   context filling, an irreversible action, a correction, or a phase boundary.
   Routine progress goes in the registers, not the conversation
8. **When the work stops, answer:** *"Which parts of this did you actually run,
   and what are you unsure about?"* — at a phase boundary, a blocker, or a
   `/clear`, not after every chunk
9. **A green test is not a fix.** Verify on screen before recording anything as
   fixed — D-1 passed six unit tests while still visibly broken
