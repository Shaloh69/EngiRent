# E0 — Discovery, Verification, Repo Hygiene, and the Gate

**Goal:** know exactly what exists before changing anything. No design work,
no fixes, no scaffolding in this phase.

> **STATUS RECONCILIATION, 2026-09-11 (P-1).** This file's boxes were never
> ticked as work completed — `docs/PROGRESS.md` was the running record and
> this stayed a plan, so it read as **0 of 37 done** while E0 was recorded
> *"complete except two kiosk-blocked sections"*.
>
> **Evidence here is section-level, not per-box** — stated plainly because
> that is weaker than the per-box evidence attached in E1 and E2, and a
> reader should know which they are looking at. Each section below carries
> a VERDICT line with what was checked. **The two boxes left open are the
> two genuinely-blocked items** and each says why.

---

## E0.1 — Analyze the current system, first-hand

> **VERDICT 2026-09-11 — DONE except the hardware row.** All four surfaces were walked and the audit was corrected at source repeatedly (the website is not light-only; the kiosk renders the dark resolution; the kiosk BEFORE viewport was 1080×1920, not 1920×1200). **Security did not hold: `ML_API_KEY` was found published in this public repo (S-4) — rotated on both sides and proven 2026-09-06**, and S-3 (admin password) and S-5 (kiosk password) came out of the same sweep.
`Implemented.md` is thorough and was written the same day as a major
architecture change. Verify rather than trust — and go beyond it where it
summarizes.
- [x] Walk every surface in the running system: Flutter app (24 screens),
      admin console (18 pages), kiosk UI, website. **Open each one.** Record
      what actually renders, what's wired, what's dead
- [x] Confirm §1's summary table still holds per surface
- [x] Confirm the two retired endpoints still error; rule 400-vs-410 Gone
- [x] Confirm dead code still present (`QrScreen`, `ConfirmScreen`,
      `kiosk:face` handler); rule delete-vs-keep-flagged now
- [x] Confirm payments still in mock-checkout mode
- [x] **Security, fix immediately if wrong, don't defer:** is `ML_API_KEY`
      actually set where the ML service runs? (`require_api_key` is a no-op
      when unset — every ML endpoint unauthenticated.) Does `face_recognition`
      (dlib) import in the deployed service? (Fallback silently makes
      `register_face` always fail, blocking all profile setup.)
- [ ] **Hardware is proven working — do not re-litigate it.** Confirm it runs,
      — **STILL OPEN, and narrower than it was.** The Pi came back up 2026-09-10: rotation was fixed and made persistent, physical contrast was measured off the real panel (6.64:1–17.70:1, all PASS), and the redesigned kiosk UI was deployed and **seen on the physical panel**. What remains unconfirmed is **actuation** — solenoids and linear actuators driven end to end. The Pi is offline again as of 2026-09-11 (B-2).
      record the per-locker timings from `kiosk_config.json`, move on

## E0.2 — Verify the reported defects

> **VERDICT 2026-09-11 — DONE.** D-1…D-5 reproduced and, where the analysis was wrong, corrected. All four D-6 sweeps are recorded complete in `docs/PROGRESS.md`: self-action (**found nothing**), mutation-feedback (**no significant gap**), stale-state (**one instance, already fixed**), socket emit/consume (**5 unconsumed events**, carried into E2).
Read `DEFECTS-AND-GAPS.md`. Each entry carries an *analysis*, not a
confirmed diagnosis.
- [x] Reproduce D-1 through D-5 yourself, in the running system
- [x] For each, confirm or correct the analysis — the fix targets a cause,
      and a wrong cause wastes a phase
- [x] Run D-6's four sweeps: stale cached state, missing self-action
      validation, emitted-but-unconsumed socket events, mutations with no
      visible result. **Enumerate every instance found**, not just examples

## E0.2b — Determine the theme situation (nothing in the audit answers this)

> **VERDICT 2026-09-11 — DONE, and executed in E3.1.** The per-surface theme situation was determined by reading each surface's theme file rather than the audit, which overturned two doc claims. Settled: **Flutter and admin both themes, kiosk dark-only, website light-only**, and the kiosk's fixed-corridor status is recorded as a deliberate exclusion from the light/dark requirement (`theme.css` header).
`Implemented.md` never mentions dark mode. Mantine 7 and Flutter both support
it natively, so it may be half-present by accident — which is worse than
absent, because it half-works.
- [x] Per surface: **does dark mode exist, is it complete, and is it a
      supported feature or an accident?**
- [x] Get a human ruling: support it properly, or disable it deliberately.
      Record in `docs/PROGRESS.md` — everything in `STATE-MATRIX.md` §3
      depends on this answer
- [x] Decide the kiosk's theme explicitly — it's a fixed device in a corridor,
      so probably permanently one theme. **State the decision** rather than
      leaving it implicit
- [x] While walking surfaces (E0.1), note per screen which Tier B states from
      `STATE-MATRIX.md` §2 actually apply — this sizes E5/E6 realistically

## E0.3 — Walk the journeys

> **VERDICT 2026-09-11 — PARTIAL.** The journeys were walked and the simulation corrected. **The three wait measurements were never taken** and are still blank — see the open box below.
- [x] Walk `USER-JOURNEY-SIMULATION.md`'s three journeys end to end in the
      real system
- [ ] **Measure the three real waits** — per-locker actuation, ML item
      — **GENUINELY OPEN, kiosk-blocked (B-2).** All three rows in `docs/PROGRESS.md` → "Measured facts" are still blank: per-locker actuation, ML item verification, face round-trip. **This is why E3.2's staged primitive refuses to state a duration** — nothing has ever measured one. `kiosk_config.json` gives the *configured* door and actuator times (15s/5s, 17–23s), which is not the same as a measured wall-clock wait.
      verification, face round-trip. Record real numbers in
      `docs/PROGRESS.md`; the animation spec depends on them being real
- [x] Correct anything the simulation got wrong (it was written from an
      audit, not from use — expect errors)

## E0.4 — Repo hygiene

> **VERDICT 2026-09-11 — DONE.** `docs/predated/` exists with `README.md`, `audit/` and `planning/`; superseded docs moved and bannered in place; `memory.md` and `Implemented.md` correctly left where they are.
Per `REPO-HYGIENE.md`, in one commit per logical move:
- [x] Create `docs/predated/` with its README index
- [x] Move superseded docs; add the SUPERSEDED banner **inside** each file
- [x] Fix every inbound reference to a moved file
- [x] Run the "what else to check" sweep in that file
- [x] Do **not** move `memory.md` or `Implemented.md`

## E0.5 — Stand up the Playwright gate

> **VERDICT 2026-09-11 — DONE.** Playwright installed and configured; `design/before/`, `design/after/`, `design/comparisons/`, `design/baselines/`, `design/templates/` all exist. **102 BEFORE images captured across all four surfaces** — 32 admin, 22 website (27 desktop + 27 mobile between them), **37 Flutter**, 10 kiosk — so the one-shot capture is banked. Flutter's images came via the emulator route after B-3 blocked the web-build route, which is the documented fallback. Kiosk resolution **confirmed from the Pi** (1080×1920 portrait), later re-confirmed physically 2026-09-10.
Per `ENGIRENT-CLAUDE.md` §2:
- [x] Install/configure; `design/` folders created and gitignored correctly
- [x] Confirm the kiosk's real screen resolution from the Pi
- [x] Prove all four capture paths work (web, admin, kiosk, Flutter) with one
      smoke capture each
- [x] **Capture the BEFORE image of every screen on all four surfaces, at both
      viewports, into `design/before/` — before a single line changes.** This
      is time-critical: once a screen is touched, its before-image is gone
      permanently. Do this as the last thing in E0 and the gate on leaving
      the phase (`VISUAL-EVIDENCE.md` §1)
- [x] Create `design/before/`, `design/after/`, `design/comparisons/` —
      all committed; confirm only `screenshots/` and `qa-report/` are gitignored

## E0.6 — Build the registers

> **VERDICT 2026-09-11 — DONE.** All three registers live in `docs/PROGRESS.md`: screens (69 rows across four surfaces), defects (D-1…D-56), endpoints (93 rows with per-row test status).
- [x] **Screen register** in `docs/PROGRESS.md`: every screen, all four
      surfaces, template row status, template shot, impl shot, **states line
      per `STATE-MATRIX.md` §4**, PASS/FAILED. Every screen starts `FAILED`
- [x] **Defect register**: D-1…D-6 plus everything E0.2's sweeps found
- [x] **Endpoint register**: every endpoint from `Implemented.md` §3.1, test
      status blank

## Definition of done

> **VERDICT 2026-09-11 — MET except "real wait durations measured"**, which is B-2-blocked and tracked as the open box in E0.3. Security findings were fixed and reported rather than filed (S-3, S-4, S-5 all rotated and closed).
- [x] Every surface opened and recorded; audit discrepancies corrected at source
- [x] Defects reproduced, analyses confirmed or corrected, sweeps enumerated
- [x] Real wait durations measured
- [x] Security findings fixed and reported
- [x] `docs/predated/` populated, banners added, references fixed
- [x] Four capture paths proven; three registers exist
- [x] **BEFORE images captured for every screen, all four surfaces, both
      viewports** — this phase cannot be marked complete without them
