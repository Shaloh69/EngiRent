# CAPABILITY-GAPS.md — What the API Already Supports That No UI Exposes

Derived by reading `Implemented.md`'s endpoint list and Prisma models against
what the four surfaces actually surface. **Everything below is powered by an
endpoint or model that already exists** — these are missing front doors, not
new features. That distinction matters: each item costs UI work, not backend
work, unless the row says otherwise.

> **⚠ CORRECTED 2026-09-06 — five of the ten user-facing items are ALREADY
> BUILT.** Verified against the running app, not the endpoint list:
> **C-1 extend rental** (`rental_detail_screen.dart:267`) — the doc calls this
> "the single most valuable missing user control in the product" and E5.1b makes
> it the priority; it shipped long ago · **C-2 notification preferences** (its
> own screen, GET+PUT) · **C-3 cancel rental** (`:223`) · **C-7 account
> deletion** (`home_screen.dart:1456`, with password confirmation) · **C-9
> payout destination** (own screen + a Profile tile that changes on
> `payoutConfigured`). **C-5 is partial** (a Ratings button reaches
> `ReviewsScreen(userId:)`, but there is no full profile). Only **C-4 refund**
> and **C-8 change password** look genuinely absent.
>
> **Consequence for the recommended four:** C-1 is done, so the recommendation
> is now **A-2 first** (the verification funnel — it measures the blast radius
> of D-1, which affected every user who had submitted an ID), then A-1, A-3,
> and **C-5 in place of C-1** — a public trust profile is the strongest genuinely
> missing item, and `GET /reviews/user/:userId` is already public.

**Verify in E0 before building.** These are inferred from the documented
surface; some may already be partially built and simply hard to find, which is
itself a finding worth recording.

---

## Part 1 — More control for the user (Flutter app)

Ranked by *how badly its absence hurts*, not by build cost.

### C-1 — Extend a rental — `PATCH /rentals/:id/dates` **exists**
The endpoint is implemented and documented. Nothing in the journey walkthrough
suggests the app exposes it. **This is the single most valuable missing user
control in the product**: the alternative to extending is returning late, which
triggers late fees and disputes — the exact things generating admin workload.
Give a renter a first-class "extend" action from the rental detail screen and
you remove a whole category of avoidable conflict.
- Show current end date, new cost, and availability (`GET /items/:id/booked-dates`
  already tells you if the extension collides with someone else's booking)
- Owner should see extension requests in their own rentals view

### C-2 — Notification preferences — `GET/PUT /notifications/preferences` **exists**
A full preferences endpoint exists. Pairs directly with D-5's toast/push work
(`DEFECTS-AND-GAPS.md`) — building push without honouring the preferences
endpoint that already exists would be the wrong order. Per-type opt-in:
rental status, messages, deposit/return outcomes, verification approval.

### C-3 — Cancel a rental — `POST /rentals/:id/cancel` **exists**
Confirm whether the app exposes this. If it doesn't, users have no way out of
a booking except contacting an admin — which routes an entirely mechanical
action through a human.

### C-4 — Request a refund — `POST /payments/:transactionId/refund` **exists**
Same shape: an implemented endpoint whose absence turns a self-service action
into a support ticket.

### C-5 — Public user profiles / trust signals — `GET /reviews/user/:userId` is **public**
A renter deciding whether to trust a stranger with equipment currently sees
nothing about them. This endpoint is already public and unauthenticated.
Surface: rating, review count, member-since, verification badge, items listed.
**This is a marketplace's core trust primitive and it's already queryable.**

### C-6 — My reviews — `GET /reviews/me` **exists**
Reviews you've written and received, in one place.

### C-7 — Account deletion — `DELETE /account` **exists** (requires password)
Implemented server-side. If it isn't reachable from Settings, that's worth
fixing on principle as well as on likely policy grounds — an account someone
can create but not delete is a bad default. Needs a clear consequences screen
(active rentals? outstanding deposits?) before confirmation.

### C-8 — Change password — `PUT /auth/password` **exists**
Basic, and easy to have skipped.

### C-9 — Payout destination — `PUT /auth/payout-destination` **exists**
Provider enum + bank/e-wallet details. Owners can't get paid without this, so
it needs to be findable, not buried — and its status ("payout method not set")
belongs on the owner's dashboard, not only in Settings.

### C-10 — Booked-dates calendar — `GET /items/:id/booked-dates` **exists**
Already in `TEMPLATE-LINKS.md` as first-class on item detail. Restated here
because it's the same pattern: a real endpoint whose absence causes a bad
experience (pick a date → get rejected).

---

## Part 2 — More data for the admin console

Every item below is computable from existing models — `User`, `Item`,
`Rental`, `Transaction`, `Verification`, `Locker`, `KioskConfig`,
`Notification`, `Feedback`, `AuditLog`, `AppRelease`, `Review`. Most are
**new read-only aggregate endpoints** under `/admin/reports`, following the
pattern the existing report endpoints already use. Flag anything that needs a
schema change — none of these should.

### A-1 — Locker utilization (4 lockers is a hard capacity ceiling)
The single biggest blind spot. There are **four** lockers; nothing measures
against that ceiling.
- Occupancy % per locker over a period; fleet occupancy right now
- **Average dwell time** — how long items actually sit before pickup
- Turnover count per locker — is the fleet used evenly, or is locker 4 dead?
- Downtime per locker, from `kiosk:status`/`kiosk:error` history
- **Hardware error rate per locker** — the actuator/solenoid timings are
  hand-calibrated *because* the units behave differently; a locker drifting
  toward failure should be visible before it strands someone

### A-2 — The verification funnel and its drop-off
`User` carries registration, ID submission, face registration, and verified
state. Nobody can currently see **where people give up**: registered → ID
submitted → face registered → admin-approved → verified. Given D-1 (status
never shown or updated), the drop-off at that step is probably significant and
currently invisible.

### A-3 — ML confidence distribution, not just the queue
The pipeline returns a 0–100 confidence and buckets at 85/60. The admin sees
individual items needing review; nobody sees the **distribution**.
- Histogram across all verifications, banded by the three thresholds
- **What fraction is fully automated vs. needing a human** — this is the
  single number that says whether the ML pipeline is earning its complexity
- **Admin override rate** in the 60–84 band: when a human reviews, how often
  do they agree with the model? That's the real calibration signal
- **OCR bonus impact** — `hybrid.py`'s flat +10 can push a 76 over the
  85 auto-approve line. Show how often that actually happens; if it's
  frequent, the bonus needs a cap and that's a real finding

### A-4 — Rental funnel and lifecycle
- Status distribution; **cancellation rate**
- Average rental duration vs. booked duration
- **Late returns**, and late-fee revenue (Settings already carries a
  deliberately non-editable late-fee reference table — nothing reports against it)
- Time-to-pickup after booking (are people booking and not collecting?)
- Extension frequency, once C-1 exists

### A-5 — Financial health, distinct from the existing transaction list
- Payment success/failure rate (`Transaction` status)
- Refund rate and total refunded
- **Deposits currently held** — real money the platform is sitting on; a
  liability nobody currently sees as a number
- Revenue trend; commission if applicable
- **Flag prominently that payments are in mock mode** while no
  `PAYMONGO_SECRET_KEY` is configured — an admin reading a revenue chart built
  on mock transactions should not have to infer that

### A-6 — Kiosk health history
Currently there's a live SSE log stream. There's no *history*.
- Uptime/connectivity over time per kiosk
- Self-test results over time
- Error events (`kiosk:error`) trended — a rising rate is the early warning
  before a locker strands someone
- **Whether these events are persisted at all** needs checking first; if
  they're only broadcast live and never written, that's a small justified
  addition (persist them) before any of this is queryable

### A-7 — Item and catalog health
- Category/condition breakdown, average price
- **Aging inventory** — listed but never rented; with only 4 lockers, a stale
  listing occupying a slot is a real cost
- Rating distribution per item and per owner
- Most/least rented

### A-8 — User growth and engagement
- Signups over time; verified vs. unverified split
- Repeat-usage rate (one-off users vs. actual adopters)
- Top owners by rentals, top renters by spend
- **App version adoption** — `AppRelease` exists and the update-gate uses it;
  nobody can see how many users are on an old build. This matters directly
  because the Flutter app has a **baked-in tunnel URL** that breaks silently
  when the Cloudflare quick tunnel rotates

### A-9 — Audit log, surfaced as insight not just a list
`AuditLog` is already written on every admin action and every lock override.
- Who did what, filterable — the list exists
- **Override frequency**: how often are defaults being overridden, and by
  whom? That says whether the default policy fits reality
- Settle/dispute resolution history, once E6's settle action exists

### A-10 — Feedback and SUS-style trend
`Feedback` is collected and triaged. Nothing trends it over time. A queue
answers "what needs handling"; a trend answers "is this getting better."

---

## Part 3 — How to scope these

**Do not build all of this.** It's a menu, and shipping every item would
double the size of this track.

Recommended: **A-1, A-2, A-3, and C-1 are the high-value four.** Locker
utilization (hard capacity ceiling), the verification funnel (where D-1 is
almost certainly costing users), ML calibration (whether the pipeline earns
its complexity), and rental extension (removes a whole class of dispute).

Everything else goes in `docs/PROGRESS.md`'s backlog with a note that it's
API-supported and UI-missing, so a later session can pick it up knowing the
backend work is already done.

Each new admin aggregate endpoint follows the existing `/admin/reports`
pattern — read-only, `requireStaff` or `requireAdmin` as appropriate, and
**gets a test in E1's suite**, same as every other endpoint.
