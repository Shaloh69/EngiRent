# E7 — Website + Sign-off

## E7.1 — Website
- [ ] Home/landing — **trust is the job**, not feature listing
- [ ] About — hardware facts sourced, not written from memory
- [ ] Pricing — deposit mechanics legible; top user anxiety
- [ ] Docs · Blog (real engineering journal — don't marketing-ify it)
- [ ] **Mock payment page** — unmistakably a test payment

## E7.2 — Full register review
- [ ] Every screen, all four surfaces: template row, all three images
      (TEMPLATE/BEFORE/AFTER at both viewports), triptych, conformance note
- [ ] `design/comparisons/index.html` generated and reviewed end to end —
      this is the review surface, not a folder of loose files
- [ ] **Any screen still `FAILED` is named in the final report with its
      reason.** Quietly leaving failures unlisted is worse than naming them
- [ ] Endpoint register: full coverage or named gaps
- [ ] Defect register: closed or explicitly deferred

## E7.3 — Cross-surface consistency
- [ ] Status semantics identical across four surfaces
- [ ] Locker numbering/representation identical
- [ ] Three loading treatments used correctly and consistently
- [ ] Real-time behaviour consistent (E2.2) — no surface still needs reloading

## E7.4 — Version consistency
Two independent sources of truth exist (website static config; app's DB-backed
`AppRelease` + `LATEST_APP_VERSION`). In sync now, **have drifted before.**
- [ ] Confirm they agree; note in the runbook that both update together

## E7.5 — Sign-off
- [ ] `docs/REDESIGN-SIGNOFF.md`: what changed per surface, **linking the
      comparison triptychs rather than re-describing them in prose**, all three registers with remaining failures named, open
      decisions, and what was deliberately not touched (face-verification
      trust architecture, ML thresholds, GPIO timings)
- [ ] `Implemented.md` updated to reflect the new reality — an audit that
      only lives in a signoff doc rots fast
