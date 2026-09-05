# E0 — Discovery, Verification, Repo Hygiene, and the Gate

**Goal:** know exactly what exists before changing anything. No design work,
no fixes, no scaffolding in this phase.

## E0.1 — Analyze the current system, first-hand
`Implemented.md` is thorough and was written the same day as a major
architecture change. Verify rather than trust — and go beyond it where it
summarizes.
- [ ] Walk every surface in the running system: Flutter app (24 screens),
      admin console (18 pages), kiosk UI, website. **Open each one.** Record
      what actually renders, what's wired, what's dead
- [ ] Confirm §1's summary table still holds per surface
- [ ] Confirm the two retired endpoints still error; rule 400-vs-410 Gone
- [ ] Confirm dead code still present (`QrScreen`, `ConfirmScreen`,
      `kiosk:face` handler); rule delete-vs-keep-flagged now
- [ ] Confirm payments still in mock-checkout mode
- [ ] **Security, fix immediately if wrong, don't defer:** is `ML_API_KEY`
      actually set where the ML service runs? (`require_api_key` is a no-op
      when unset — every ML endpoint unauthenticated.) Does `face_recognition`
      (dlib) import in the deployed service? (Fallback silently makes
      `register_face` always fail, blocking all profile setup.)
- [ ] **Hardware is proven working — do not re-litigate it.** Confirm it runs,
      record the per-locker timings from `kiosk_config.json`, move on

## E0.2 — Verify the reported defects
Read `DEFECTS-AND-GAPS.md`. Each entry carries an *analysis*, not a
confirmed diagnosis.
- [ ] Reproduce D-1 through D-5 yourself, in the running system
- [ ] For each, confirm or correct the analysis — the fix targets a cause,
      and a wrong cause wastes a phase
- [ ] Run D-6's four sweeps: stale cached state, missing self-action
      validation, emitted-but-unconsumed socket events, mutations with no
      visible result. **Enumerate every instance found**, not just examples

## E0.2b — Determine the theme situation (nothing in the audit answers this)
`Implemented.md` never mentions dark mode. Mantine 7 and Flutter both support
it natively, so it may be half-present by accident — which is worse than
absent, because it half-works.
- [ ] Per surface: **does dark mode exist, is it complete, and is it a
      supported feature or an accident?**
- [ ] Get a human ruling: support it properly, or disable it deliberately.
      Record in `docs/PROGRESS.md` — everything in `STATE-MATRIX.md` §3
      depends on this answer
- [ ] Decide the kiosk's theme explicitly — it's a fixed device in a corridor,
      so probably permanently one theme. **State the decision** rather than
      leaving it implicit
- [ ] While walking surfaces (E0.1), note per screen which Tier B states from
      `STATE-MATRIX.md` §2 actually apply — this sizes E5/E6 realistically

## E0.3 — Walk the journeys
- [ ] Walk `USER-JOURNEY-SIMULATION.md`'s three journeys end to end in the
      real system
- [ ] **Measure the three real waits** — per-locker actuation, ML item
      verification, face round-trip. Record real numbers in
      `docs/PROGRESS.md`; the animation spec depends on them being real
- [ ] Correct anything the simulation got wrong (it was written from an
      audit, not from use — expect errors)

## E0.4 — Repo hygiene
Per `REPO-HYGIENE.md`, in one commit per logical move:
- [ ] Create `docs/predated/` with its README index
- [ ] Move superseded docs; add the SUPERSEDED banner **inside** each file
- [ ] Fix every inbound reference to a moved file
- [ ] Run the "what else to check" sweep in that file
- [ ] Do **not** move `memory.md` or `Implemented.md`

## E0.5 — Stand up the Playwright gate
Per `ENGIRENT-CLAUDE.md` §2:
- [ ] Install/configure; `design/` folders created and gitignored correctly
- [ ] Confirm the kiosk's real screen resolution from the Pi
- [ ] Prove all four capture paths work (web, admin, kiosk, Flutter) with one
      smoke capture each
- [ ] **Capture the BEFORE image of every screen on all four surfaces, at both
      viewports, into `design/before/` — before a single line changes.** This
      is time-critical: once a screen is touched, its before-image is gone
      permanently. Do this as the last thing in E0 and the gate on leaving
      the phase (`VISUAL-EVIDENCE.md` §1)
- [ ] Create `design/before/`, `design/after/`, `design/comparisons/` —
      all committed; confirm only `screenshots/` and `qa-report/` are gitignored

## E0.6 — Build the registers
- [ ] **Screen register** in `docs/PROGRESS.md`: every screen, all four
      surfaces, template row status, template shot, impl shot, **states line
      per `STATE-MATRIX.md` §4**, PASS/FAILED. Every screen starts `FAILED`
- [ ] **Defect register**: D-1…D-6 plus everything E0.2's sweeps found
- [ ] **Endpoint register**: every endpoint from `Implemented.md` §3.1, test
      status blank

## Definition of done
- [ ] Every surface opened and recorded; audit discrepancies corrected at source
- [ ] Defects reproduced, analyses confirmed or corrected, sweeps enumerated
- [ ] Real wait durations measured
- [ ] Security findings fixed and reported
- [ ] `docs/predated/` populated, banners added, references fixed
- [ ] Four capture paths proven; three registers exist
- [ ] **BEFORE images captured for every screen, all four surfaces, both
      viewports** — this phase cannot be marked complete without them
