# E5 — Flutter App

Per-screen process: template row in `TEMPLATE-LINKS.md` → template shot →
rebuild in E3 tokens → wire real endpoints → impl shot → PASS or `FAILED`.
**No row = stop and write one first.** Kiosk-flow screens done in E4.

## E5.1 — Screens
- [ ] Onboarding · Login · Register · Profile completion
- [ ] **ID photo capture** · **Face registration** — explanation-before-camera
      (`USER-JOURNEY-SIMULATION.md` A2), and correct already-verified states (E2.4)
- [ ] Home dashboard · Item browse · Item detail (+ booked-dates calendar)
- [ ] **My Rentals** — behaviour already built in E2.5; this phase runs it
      through the full screen process (template row, shots, register). Don't rebuild it
- [ ] Rental detail
- [ ] Create listing · My items
- [ ] Payments/checkout — **both mock and live states**
- [ ] Transaction history · Messages (live, E2.2) · Notifications · Reviews
- [ ] Feedback · Settings (verification status, E2.4) · Payout destination

## E5.1b — User controls from `CAPABILITY-GAPS.md` Part 1
Endpoints that already exist with no front door. **C-1 is the priority** —
without it, the only alternative to extending a rental is returning it late,
which generates the late fees and disputes that create admin workload.
- [ ] **C-1 Extend rental** (`PATCH /rentals/:id/dates`) — from rental detail;
      show new end date, new cost, and collision check via `GET /items/:id/booked-dates`
- [ ] **C-2 Notification preferences** (`GET/PUT /notifications/preferences`) —
      build this *with* E2.3's push work, not after; honouring existing
      preferences is part of doing push correctly
- [ ] C-3 Cancel rental · C-4 Request refund — confirm whether exposed; build if not
- [ ] **C-5 Public user profile / trust signals** (`GET /reviews/user/:userId`,
      already public) — rating, review count, member-since, verification badge.
      A marketplace's core trust primitive, already queryable
- [ ] C-6 My reviews · C-7 Account deletion · C-8 Change password
- [ ] C-9 Payout destination — findable, and its unset state surfaced on the
      owner dashboard, not buried in Settings
- [ ] Anything not built here goes to `docs/PROGRESS.md`'s backlog marked
      **API-supported, UI-missing**

## E5.2 — Localization ruling (don't default silently)
32 translated keys; ~20 screens hardcoded English. Finish it / remove the
picker / state plainly what's translated. **Silently half-working is the worst
of the three.** Get a human ruling, record it.

## E5.3 — Demo mode
`AppConstants.demoMode` fabricates data on API failure in debug builds.
- [ ] Make it visually unmistakable when active (debug banner) so nobody demos
      fabricated data believing it's real

## Definition of done
- [ ] Every screen PASS in the register, or explicitly deferred with a reason
- [ ] Localization ruling recorded; demo mode obvious
