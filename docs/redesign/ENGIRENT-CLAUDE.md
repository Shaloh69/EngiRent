# ENGIRENT-CLAUDE.md — Rules for This Redesign Track

Read alongside the repo's existing `CLAUDE.md` and `memory.md` (which
`Implemented.md` §12 identifies as the actual up-to-date engineering log —
more current than either doc in `docs/audit/`). This file adds redesign
process; it doesn't relax anything already in force.

## 1. Scope boundary

**Redone:** the presentation layer across all four surfaces — Flutter screens,
admin pages, kiosk UI, website — plus the animation/loading layer and the
two-screen handoff choreography.

**Not redone, do not touch as part of this track:**
- The face-verification trust architecture (`Implemented.md` §6). The kiosk
  validating the scanned QR itself — only the token currently live in its own
  process, inside the 90s TTL, single-use (corrected 2026-09-06 in E1: it is
  an identity match against the live token, **not** a signature
  recomputation) — `resolveFaceSubject` deriving identity
  from rental status rather than client input, the server-side session store,
  Node calling the ML service so the API key never reaches a client, and
  **failing closed** when ML is unreachable — all of this is correct and was
  hard-won. Design *around* it, never redesign it.
- GPIO timing values in `kiosk_config.json` — hand-calibrated per physical
  locker, verified twice against real hardware. If an animation and a timing
  value disagree, **the hardware is right.**
- Prisma schema, auth, payments logic.

**IN SCOPE as of 2026-09-06 (scope change, on the user's instruction): the
item-verification comparison pipeline.**

This was previously listed as untouchable alongside the face-verification trust
architecture. It is now in scope, because E0's analysis
(`ITEM-VERIFICATION-PIPELINE-GAPS.md`) found failure modes that are design
problems rather than tuning problems — chiefly that **every kiosk frame shares
the same locker interior while the owner's listing photos do not**, so global
descriptors score background agreement as object agreement, inflating
similarity between different items *and* suppressing it for the correct one.

**What is in scope:** what evidence feeds the score, and how the score is
composed. Foreground segmentation against a per-locker background plate;
stronger geometric/instance verification; treating serial OCR as an identity
*gate* rather than a flat +10 bonus; requiring agreement across independent
signal families instead of a single weighted sum; modelling the attempt
sequence rather than judging only the last try; and presentation-attack
resistance (a printed photo currently passes).

**What remains out of scope, and the distinction matters:**
- **The 85 / 60 / retry-10 thresholds stay put** unless A-3's measured
  confidence distribution says otherwise. They are not the problem; the
  evidence feeding them is. Moving a threshold to paper over a bad signal makes
  the system worse and harder to reason about.
- **The face-verification trust architecture stays untouchable** (above). Item
  comparison and identity verification are different systems that happen to
  share an ML service — opening one does not open the other.

**Sequencing requirement:** `CAPABILITY-GAPS.md` A-3 (ML confidence
distribution — the histogram banded at 85/60, the automated-vs-human fraction,
the admin override rate, and how often the OCR bonus actually changes a
verdict) is a **prerequisite, not a companion**. Right now nobody can say which
of the documented failure modes is real and which is theoretical, and this
project's own history is a warning about changing things that merely look
wrong. Measure, then change.

**Three exceptions where this track *should* add functionality**, because all
are design gaps over working backends, not new features:
1. A **settle/resolve action in the disputes UI** — `POST /admin/rentals/:id/settle`
   exists and works with no front door (`USER-JOURNEY-SIMULATION.md` Journey C).
2. **Client-side role gating** in the admin console — the Reviewer/Admin split
   is server-only; the UI shows everyone every button.
3. **A-3's ML reporting**, promoted from "recommended" to required, because the
   pipeline work above cannot be justified or verified without it.

## 2. Playwright cross-reference — MANDATORY, and it's a pass/fail gate

**No screen is complete without a template screenshot and an implementation
screenshot on disk.** This is the enforcement mechanism for
`TEMPLATE-LINKS.md`'s rule, and it is not optional or deferrable to a review
phase.

- [ ] Install `@playwright/test` if not present. Configure `snapshotDir` →
      `design/baselines`, `outputDir` → `design/screenshots/test-runs`,
      HTML reporter → `design/qa-report`
- [ ] Viewports: **1440×900** (admin, website), **390×844** (Flutter web
      preview / responsive website), **and the kiosk's actual physical
      screen resolution** — confirm it from the Pi, don't guess
- [ ] **Four committed image folders** per `VISUAL-EVIDENCE.md`:
      `design/templates/` (reference), `design/before/` (**captured in E0,
      before anything changes — one shot, no second chance**),
      `design/after/` (at PASS), `design/comparisons/` (the
      template|before|after triptych a human actually reviews)
- [ ] `design/screenshots/` — disposable iteration captures, dated, gitignored
- [ ] `design/baselines/` — Playwright's own snapshots (`snapshotDir`), committed
- [ ] **A screen with no template screenshot on disk is `FAILED`**, recorded
      as such in `docs/PROGRESS.md`, regardless of how it looks or whether
      tests pass. **One exception, ruled 2026-09-06:** a `BESPOKE` row whose
      pattern reference names a *genre* rather than a reachable URL is
      satisfied instead by an authored structural wireframe at
      `design/templates/pattern-<genre-slug>.png` **plus** a written structural
      note. Drawn, not captured — screenshotting a genre is impossible and
      committing a real product's UI to fake it vendors third-party pixels.
      Both parts, or still `FAILED`. Full statement: `TEMPLATE-LINKS.md` → THE
      GATE → AMENDMENT

**Why this is a hard gate and not a guideline:** this project has
**zero automated tests in the admin console** (no test files, no tooling, no
test script) and **2 unit tests across 24 Flutter screens**, neither of which
is a widget or integration test. There is no existing safety net that would
catch a broken screen. Screenshots are currently the only mechanism that
would. Treat "it compiles and the API call is wired" as necessary and
nowhere near sufficient.

**Flutter screens can't be Playwright-captured directly.** Use `flutter run -d
web-server` for a web build where the screen renders, or capture from a real
device/emulator via `flutter screenshot` and file it in the same folder
structure. **A Flutter screen without a captured implementation shot is
`FAILED` on the same terms as a web page** — the capture method differs, the
requirement doesn't.

### PASS / FAILED / DEFERRED — the only three statuses, defined once

Several phase files say "PASS or explicitly deferred." That is not a loophole
in the gate. The three statuses are distinct and mean different things:

- **PASS** — template row exists, template shot on disk, implementation shot
  on disk, full state coverage per `STATE-MATRIX.md`, conformance note filled
  in, looked at in a real browser/device.
- **DEFERRED** — a deliberate decision, made *with the human*, that this
  screen is out of scope for this track. Requires a recorded reason and a
  named owner (a future phase, a backlog item, or "won't do"). **A screen you
  simply didn't get to is not DEFERRED — it's FAILED.**
- **FAILED** — anything else. No template row; a `BESPOKE` row missing its
  pattern ref or justification; a missing screenshot; built but not looked at;
  ran out of time.

**FAILED is a recorded status, not a thing to avoid by lowering the bar.** A
track that ends with eight honestly-named FAILED screens is in better shape
than one that ends with eight quietly-relabelled DEFERRED ones.

## 3. Kiosk work touches real hardware — extra care

The kiosk is a Raspberry Pi 5 driving 8 solenoids and 4 linear actuators
through relay modules. UI work shouldn't reach the GPIO layer, but:
- Never change values in `kiosk_config.json`
- Test animation-to-hardware sync against **real socket events**, not mocked
  ones — the whole point of §1.1 in `ANIMATION-AND-LOADING-SPEC.md` is that
  real timing varies per locker
- The autostart supervisor script has bitten twice in production
  (`Implemented.md` §5.3 — a `pgrep` guard that self-matched, then one that
  matched nothing). Don't touch it as part of UI work

## 4. Context management

`docs/PROGRESS.md` is created in E0 and updated continuously — current phase,
what's checked, **every `FAILED` screen and why**, blockers, next concrete
step. Update it before any `/clear` or session end. A new session reads the
repo's `CLAUDE.md`, then this file, then `docs/PROGRESS.md`, and resumes
without being re-briefed.

One phase (E0–E5) per session is the target cadence.

## 5. Asset/template fetching permissions

Same scoping recommendation as any agent-driven fetch: allow
`Bash(git clone https://github.com/*)` freely (every template source in
`TEMPLATE-LINKS.md` is a public GitHub repo or a documentation site), route
raw `curl`/`wget` through "ask." Check the repo's existing `.claude/settings.json`
before assuming any of it works.

## 6. Definition of done, per screen

- [ ] Named template row exists in `TEMPLATE-LINKS.md` (or `BESPOKE` + pattern
      ref + justification — all three, or it's `FAILED`)
- [ ] All three permanent images exist: TEMPLATE, BEFORE, AFTER — at both
      viewports — plus the comparison triptych (`VISUAL-EVIDENCE.md` §1-2).
      **TEMPLATE may be an authored pattern wireframe + structural note where
      the row is genre-referenced `BESPOKE`** (amended 2026-09-06). **BEFORE
      and AFTER must be committed, not merely captured**
- [ ] **Conformance note filled in** across all four dimensions — LAYOUT, UI,
      WIDGETS, SPRITES — plus DEVIATED with reasons (`VISUAL-EVIDENCE.md` §3).
      Images prove a comparison was *possible*; the note proves one *happened*
- [ ] **Full state coverage per `STATE-MATRIX.md`** — Tier A always (6 data
      states, both themes, both viewports, reduced motion), Tier B wherever it
      applies (interaction, role, verification, outcome, real-time, content
      extremes). `N/A + why` is acceptable; blank is `FAILED`
- [ ] Any long wait uses the right treatment from
      `ANIMATION-AND-LOADING-SPEC.md` §1 — determinate where duration is
      genuinely known, staged where stages are genuinely named
- [ ] Reduced-motion respected
- [ ] Opened in a real browser/device and looked at — not inferred from code

## 7. Redo capability — any screen, any time

**Every screen must be re-doable without unpicking the rest of the system.**
That's a structural requirement, not a nice-to-have, because this track will
almost certainly want a second pass at some screens after seeing them real.

- Screens consume **E3's tokens**, never raw values — a token change restyles
  everything without touching screen code
- Screens consume **shared components** (status chip, toast, loading
  primitives, connection indicator), never local reimplementations. Grep for
  duplicated implementations at the end of each phase; there shouldn't be any
- **Data fetching lives outside the widget/component tree** — a screen can be
  thrown away and rebuilt against the same service/hook without touching
  network code
- Each screen's template row, template shot, and impl shot make a redo
  *verifiable*: rebuild, recapture, compare against the same reference
- **Redoing a screen is normal, not a failure.** Record it in the register as
  a new pass rather than editing history — knowing a screen took three passes
  is useful information

## 8. Claude Code practices this track follows

Drawn from Anthropic's own guidance (`code.claude.com/docs/en/best-practices`)
and adapted to this project's realities:

- **`CLAUDE.md` + this file are auto-loaded context.** If you notice yourself
  re-deriving decisions already made, context is full — update
  `docs/PROGRESS.md`, `/clear`, and reload rather than pushing through
- **Context degradation has happened TWICE on this track, and both times the
  human noticed before the model did** (`docs/PROGRESS.md` → CONTEXT
  DEGRADATION LOG). Noticing it is therefore not a skill this track can rely
  on, so `CLAUDE-CODE-PLAYBOOK.md` §2d replaces the advice with **seven
  checkable gates, G1-G10**. Read them before starting a phase. The one that
  binds most often: **G1, at most one unverified chunk at a time** — and
  verification blocked by a permission refusal or offline hardware still
  counts as unverified. The second occurrence looked like productive,
  well-tested work, not like confusion
- **Explore → plan → implement → verify.** For anything touching more than one
  file, state the plan before editing. This project has already been bitten
  three times by code that compiled, passed tests, and was broken on screen
- **Write the test first where there's a correct answer** — especially E1's
  self-action rejections. **Watch them fail before you fix them**; a test that
  never failed proves nothing
- **One phase per session, `/clear` between phases.** `docs/PROGRESS.md` is
  the continuity mechanism, not conversation history
- **Small, verifiable commits**, one logical change each
- **Tick the phase-file box in the same commit as the work (G9).** The phase
  files are records, not plans. Leaving them for phase-close is how E0 came to
  read 0 of 37 done while being recorded complete. A deferred item stays
  unticked and carries its **ruling**; a blocked one stays unticked and carries
  its **blocker**. Never bulk-tick
- **Ask for the diff, not the file**, on anything touching several screens
- **Subagents for genuinely parallel read-only work** (e.g. auditing four
  surfaces' socket consumers) — not for anything writing to the same files
- **Default to continuing, not reporting.** `docs/PROGRESS.md` is the running
  record. Interrupt the human only when they can actually *act* on it — blocked,
  a ruling needed, a security finding, context filling, an irreversible action
  on a live system, a correction to something already reported, or a phase
  boundary. Full criteria: `ENDGOAL-AND-TRACKING.md` §2, "When to surface
  something". Routine progress is noise that hides the line that mattered
- **When the work stops, answer:** *"Which parts of this did you actually run,
  and what are you unsure about?"* — at a phase boundary, a blocker or a
  `/clear`, not after every chunk. The honest answer is usually the session's
  most valuable output, which is why it shouldn't be diluted into a ritual
- **The repo wins over the docs.** If a phase file conflicts with what's
  actually in the code, flag it, fix the doc, then proceed
