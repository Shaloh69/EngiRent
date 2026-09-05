# E6 — Admin Console + Remaining Kiosk Screens

## E6.1 — Admin pages (Mantine 7 — do not substitute a Tailwind template)
- [ ] Dashboard · Users · Items · Rentals (+ conversation view)
- [ ] **Disputes — build the resolve action.** `POST /admin/rentals/:id/settle`
      exists server-side with no UI
- [ ] Payments/transactions · **Verifications queue — three ML outcomes, three
      visual languages** (≥85 / 60–84 / <60)
- [ ] ID verifications — **and emit the approval event from E2.4 here**
- [ ] Feedback · Reports · Audit log
- [ ] **Kiosk control — physical-consequence page.** Confirmation proportional
      to consequence; live/stale/dead SSE state unmistakable
- [ ] Health/self-test · Settings

## E6.1b — Admin data from `CAPABILITY-GAPS.md` Part 2
New read-only aggregates following the existing `/admin/reports` pattern.
**Build A-1, A-2, A-3 — the recommended high-value set.** Each gets a test in
E1's suite like any other endpoint. Everything else goes to the backlog marked
API-supported, UI-missing.
- [ ] **A-1 Locker utilization** — 4 lockers is a hard capacity ceiling and
      nothing measures against it: occupancy, dwell time, turnover, downtime,
      per-locker hardware error rate
- [ ] **A-2 Verification funnel** — registered → ID submitted → face
      registered → approved → verified, with drop-off. Given D-1, the drop-off
      at the approval step is likely significant and currently invisible
- [ ] **A-3 ML confidence distribution** — histogram banded at 85/60, the
      automated-vs-human fraction, admin override rate in the 60–84 band, and
      **how often the OCR +10 bonus pushes a sub-85 over the line** (if it's
      frequent, that's a real finding needing a cap)
- [x] ~~First check whether `kiosk:error`/`kiosk:status` events are persisted~~
      **ANSWERED 2026-09-06: they are NOT, and deliberately so.**
      `utils/kioskEventLog.ts` keeps a 40-event in-memory ring buffer per kiosk
      whose docstring reads *"Deliberately not persisted to the database — this
      is debugging context for triage, not a system of record."* So A-6's
      history needs a **schema change and a reversed design decision**, not "a
      small justified addition". Treat it as its own scoped item, not a
      prerequisite bullet
- [ ] Flag prominently anywhere revenue is shown that payments are in **mock
      mode** while no `PAYMONGO_SECRET_KEY` is set

## E6.2 — Client-side role gating
Reviewer vs Admin is server-side only; the UI shows everyone every button.
- [ ] Build real client-side guards
- [ ] **Server-side stays authoritative** — this is a UX fix, not a security
      boundary, and must not be described as one

## E6.3 — Small inconsistencies from the audit
- [ ] Kiosk-ID fallbacks disagree (`KIOSK-001` vs `kiosk-1`)
- [ ] API base-URL fallback duplicated outside the shared axios client in two
      files for raw SSE `fetch()`

## E6.5 — Item-verification pipeline (SCOPE CHANGE 2026-09-06)

Moved into scope on the user's instruction. Full analysis:
`ITEM-VERIFICATION-PIPELINE-GAPS.md`. Placed here, after E6.1b, because **A-3
is a hard prerequisite** — it is the only way to tell which failure mode below
is real.

- [ ] **Gate on A-3 first.** Do not change the pipeline until the confidence
      distribution exists and the following are known: the automated-vs-human
      fraction, the admin override rate in the 60-84 band, and **how often the
      OCR +10 actually flips a verdict**. If OCR promotion is rare, §2.5 is
      theoretical; if common, it is the most urgent item
- [ ] **Foreground segmentation against a per-locker background plate** — the
      highest-value change. Every kiosk frame shares the same locker interior
      while the owner's listing photos do not, so colour (0.22 of the
      traditional weight), pHash and SSIM currently score **background**
      agreement as **object** agreement. This both inflates similarity between
      different items and suppresses it for the correct one. The background is
      fixed and known, so a per-locker plate is cheap to obtain
- [ ] **Serial OCR as an identity gate, not a +10 bonus** — visual comparison
      structurally cannot separate two units of the same model, and the current
      bonus can auto-approve a 76 on its own
- [ ] **Agreement across independent signal families** instead of one weighted
      sum — an 86 from colour+pHash is not the evidence an 86 from SIFT
      geometry + deep embedding is, and the formula cannot tell them apart
- [ ] **Extend the good-pair check beyond `traditional_scores`** — a verdict
      carried by deep/SIFT is currently judged by a signal that did not carry it
- [ ] **Model the attempt sequence** — 10 retries with no penalty is 10 samples
      from a noisy distribution; the last attempt should not be the only one
      that counts
- [ ] Evaluate learned local features (SuperPoint/LoFTR-class) and topological
      RANSAC against the same-brand-different-product case
- [ ] Presentation-attack resistance — a printed photo currently passes.
      Multi-frame parallax or a controlled-illumination difference frame

**Out of scope even here:** the 85/60/retry-10 thresholds, and the
face-verification trust architecture. Item comparison and identity verification
are different systems that happen to share an ML service.

**Definition of done for this section:** every change names the measured number
it moved. A pipeline change that cannot be shown to have improved a measured
outcome does not count as done — this project has been bitten repeatedly by
changes that looked right.

## E6.4 — Remaining kiosk screens
- [ ] Item capture / verification (4 cameras, ML pipeline, 3 outcomes)
- [ ] Error / retry
- [ ] Idle attract + **honest health display** — if the kiosk can't reach Node,
      say so on the idle screen before someone walks up
- [ ] Execute E0.1's ruling on `QrScreen` / `ConfirmScreen`

## Definition of done
- [ ] All admin pages PASS; settle action works end to end
- [ ] E6.5's pipeline work is either done with measured evidence, or explicitly deferred with a reason
- [ ] Role gating in place, correctly described
- [ ] Kiosk screens PASS
