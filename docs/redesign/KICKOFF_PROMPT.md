# KICKOFF_PROMPT.md

Copy this package into the repo: the eight docs into `docs/redesign/`, phases
into `docs/redesign/phases/`, `PROGRESS.md` into `docs/PROGRESS.md`. Commit on
a branch. Then paste the block below as the first message in a fresh Claude
Code session.

---

```
Read, in full, before writing any code:
  CLAUDE.md · memory.md · Implemented.md
  docs/redesign/00-START-HERE.md
  docs/redesign/USER-JOURNEY-SIMULATION.md
  docs/redesign/DEFECTS-AND-GAPS.md
  docs/redesign/CAPABILITY-GAPS.md
  docs/redesign/ENDGOAL-AND-TRACKING.md
  docs/redesign/CLAUDE-CODE-PLAYBOOK.md
  docs/redesign/TEMPLATE-LINKS.md
  docs/redesign/ANIMATION-AND-LOADING-SPEC.md
  docs/redesign/STATE-MATRIX.md
  docs/redesign/VISUAL-EVIDENCE.md
  docs/redesign/API-TEST-PLAN.md
  docs/redesign/REPO-HYGIENE.md
  docs/redesign/ENGIRENT-CLAUDE.md
  docs/redesign/FOLDER-STRUCTURE.md
  docs/redesign/phases/ (all eight)

This is a full audit, defect-fix, and presentation-layer redesign across four
surfaces — Flutter app, admin console, kiosk UI, public website — grounded in
the real API, socket, and hardware behaviour in Implemented.md, plus five
confirmed user-reported defects.

Before doing anything else, reply with the following, then stop:

1. In your own words: what EngiRent physically is, including what happens at
   the kiosk. If you can't state the QR handoff direction correctly (which
   device displays the code, which scans it, which validates the signature),
   re-read Implemented.md §6 before answering.

2. The end goal in one sentence (ENDGOAL-AND-TRACKING.md), and the eight
   phases in order — specifically why defects (E2) come before design (E3),
   and why the API suite (E1) comes before the fixes.

3. For each of D-1 through D-5 in DEFECTS-AND-GAPS.md: restate the analysis
   in your own words and say how you'd verify it's the real cause before
   fixing. Those analyses were written from the API surface, not from reading
   the failing code — at least one is probably wrong.

4. Explain the mandatory template gate, including what makes a BESPOKE row
   complete versus FAILED, why the gate is strict on this project
   specifically, and what the four conformance dimensions (LAYOUT, UI,
   WIDGETS, SPRITES) require beyond just capturing screenshots.

5. Confirm what testing actually exists today across the four surfaces, and
   what that means for how far "it compiles and the endpoint is wired" can be
   trusted.

6. Three things across these docs you think are wrong, missing, or that you'd
   do differently. Be blunt — several of these files were written from an
   audit rather than from using the running product, so real errors are
   likely. Find them.

7. From CAPABILITY-GAPS.md: which items you'd build and which you'd backlog,
   and whether you agree with the recommended high-value four (A-1, A-2, A-3,
   C-1). Disagree if you have a reason.

8. Your proposed checklist for E0 only.

Then stop and wait. Don't create files, don't scaffold, don't start E0.

From this point on, EVERY response you give in this track opens with the
status line from ENDGOAL-AND-TRACKING.md §2:
  [E0 · Discovery · 0/6 sections · defects 0/6 · screens 0/? PASS]
If you can't fill in the numbers, docs/PROGRESS.md is stale — fix that first.

Context up front:
- Most of the API is proven working in practice, hardware especially. E1
  exists to make that automated and repeatable, not to question it.
- Two items in E0.1 are potential security findings, not backlog: whether
  ML_API_KEY is set in the live deployment (it fails open when unset), and
  whether dlib imports in the deployed ML service (the fallback silently
  breaks all face registration). If either is wrong: fix it, tell me.
- The kiosk drives real relays and solenoids. UI work shouldn't reach GPIO,
  and kiosk_config.json's hand-calibrated per-locker timings are not to be
  changed — if an animation and a timing value disagree, the hardware is right.
- The repo carries documentation predating the 2026-09-03 architecture change.
  E0.4 archives it properly per REPO-HYGIENE.md — moved and bannered, never
  deleted.
- Nothing in Implemented.md says whether dark mode exists on any surface.
  E0.2b determines that per surface and gets a ruling from me — a half-present
  dark mode is worse than none, because it half-works.
- E0 captures a BEFORE image of every screen on all four surfaces before
  anything changes. That is a one-shot opportunity — once a screen is
  touched, its before-image is gone permanently. Don't skip it to move faster.
- docs/PROGRESS.md is the continuity mechanism and holds three registers
  (screens, defects, endpoints). Update it before any /clear.
- Every screen must be re-doable later without unpicking the system —
  ENGIRENT-CLAUDE.md §7. Redoing a screen is normal, not a failure.
- I'd rather you tell me something in these docs is wrong than build it
  silently.
```

---

## After it replies

Point 3 and point 6 are the load-bearing ones. If it agrees with every defect
analysis and finds nothing wrong across nine documents, it skimmed — re-run
the session rather than proceed.

Then hand it `phases/E0-discovery-and-hygiene.md`. One phase per session,
`/clear` between phases, `docs/PROGRESS.md` updated before each break, and
every session ends with: *"Which parts of this did you actually run, and what
are you unsure about?"*
