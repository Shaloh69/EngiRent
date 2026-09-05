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
- [ ] First check whether `kiosk:error`/`kiosk:status` events are **persisted
      at all** — A-6's history is unqueryable if they're only broadcast live.
      If so, persisting them is a small justified addition
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

## E6.4 — Remaining kiosk screens
- [ ] Item capture / verification (4 cameras, ML pipeline, 3 outcomes)
- [ ] Error / retry
- [ ] Idle attract + **honest health display** — if the kiosk can't reach Node,
      say so on the idle screen before someone walks up
- [ ] Execute E0.1's ruling on `QrScreen` / `ConfirmScreen`

## Definition of done
- [ ] All admin pages PASS; settle action works end to end
- [ ] Role gating in place, correctly described
- [ ] Kiosk screens PASS
