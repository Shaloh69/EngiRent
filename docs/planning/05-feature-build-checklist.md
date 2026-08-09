# EngiRent — Feature Build Checklist

Derived from the two audits in `02-design-mandate.md` §2.9 (unwired endpoints) and §2.10 (enterprise readiness). Every item below has a sourced template or reference, an explicit definition of done, and a functionality check that has to pass before it is ticked.

**Status key:** `[ ]` not started · `[~]` in progress · `[x]` done and verified

---

## Scope reality

This is **not** a single-sitting job. Fifteen work items span the Flutter app, the Node API, and the Admin Console, and three of them require schema changes. Sequenced below so that each stage is independently shippable — the app is never left half-migrated.

**Order is deliberate**: observability first (everything after it is guesswork without it), then the largest user-visible gap, then the things that need schema planning.

---

## Stage 1 — Observability (do this first)

### 1.1 Crash reporting
- [ ] Add `sentry_flutter`; wrap `runApp` in `SentryFlutter.init`
- [ ] Install a global `FlutterError.onError` + `PlatformDispatcher.instance.onError` handler
- [ ] Scrub PII before send — never ship face encodings, tokens, or ID photos in a breadcrumb
- [ ] Tag events with app version + build number from `release.ts`
- **Template:** [Sentry Flutter docs](https://docs.sentry.io/platforms/dart/guides/flutter/)
- **Done when:** a deliberately-thrown test exception appears in the dashboard with the right version tag, and the scrubber is proven by asserting a token-bearing event is redacted.

### 1.2 Analytics funnel
- [ ] Instrument: browse → item detail → checkout → paid → collected → returned
- [ ] Screen-view events on every route
- **Done when:** a full rental produces an ordered, complete event trail.

---

## Stage 2 — My Listings (largest user-visible gap, §2.9.1)

### 2.1 My Listings screen
- [ ] Wire `GET /items/my-items` (exists, never called)
- [ ] Owner's items with live state: available / rented out / unlisted
- [ ] Entry points: Profile row + home quick action
- [ ] Empty state that routes to "List an item"
- **Template:** [Universal Listings Flutter Template](https://instaflutter.com/app-templates/universal-listings-flutter-template/) for the seller-inventory pattern; reuse the existing `ItemCard` rather than inventing a card
- **Done when:** an item created in the app appears here immediately, with correct state while rented.

### 2.2 Edit listing
- [ ] Wire `PUT /items/:id` (exists, never called)
- [ ] Reuse `CreateItemScreen` in an `edit` mode — **do not build a second form**
- [ ] Pre-populate every field including photos
- **Done when:** editing a price changes it on the public listing, and cancelling changes nothing.

### 2.3 Photo management on existing listings
- [ ] Add / remove / reorder; change cover
- [ ] Reuse `_PhotoStrip` — it already supports promote-to-cover
- [ ] Refuse removing the last photo
- **Done when:** cover change is reflected in browse results.

### 2.4 Unlist / relist + delete
- [ ] Soft `isAvailable` toggle, distinct from delete
- [ ] Wire `DELETE /items/:id`
- [ ] **Block delete client-side when a rental is in flight** — do not rely on the API to refuse
- [ ] Confirmation states what happens to reviews and to any active rental
- **Done when:** deleting an item with an active rental is refused with a clear reason, not a 400 toast.

---

## Stage 3 — Feedback loop (§2.9.3, genuinely new, server included)

### 3.1 Server: `POST /feedback`
- [ ] Prisma model: category, body, screenshot path, appVersion, device, screen, rentalId?, kioskId?, status
- [ ] Category enum: bug / suggestion / kiosk problem / payment problem / other
- [ ] Rate-limit per user
- **Done when:** a submission persists with its context attached.

### 3.2 App: Send Feedback
- [ ] Profile → Send feedback
- [ ] Contextual entry from failed kiosk scan, payment error, disputed rental — pre-filling category and IDs
- [ ] Optional screenshot attach
- **Template:** [Flutter feedback-form UI collection](https://github.com/mrutyunjayagiri/flutter-custom-feedback-form-UI-collections); consider [`feedback`](https://pub.dev/packages/feedback) for annotate-the-screenshot
- **Done when:** a report filed from a failed kiosk scan arrives with kiosk ID and recent events attached.

### 3.3 Admin: triage queue
- [ ] List + filter by category/status; new → acknowledged → resolved
- [ ] **Without this the endpoint is a write-only hole** — not optional
- **Done when:** a report filed in the app appears in the console and can be resolved.

---

## Stage 3.5 — Account verification actually works (NEW — blocker)

**Traced 2026-08-09 in answer to "how does a person get verified?" The answer is: not properly. There is no review workflow at all.**

The only ways `isVerified` is ever set are (a) automatically when an admin account is created, and (b) an admin manually flipping the flag through `PATCH /admin/users/:id`. There is no queue, no evidence, no decision record, and no notification.

**Worse: the evidence cannot be viewed.** The app collects a student ID (`POST /auth/id-photo`) and stores `idImageUrl`, but `mediaRoutes` only exposes `/media/users/:userId/face.jpg` — **the ID photo is not served by any endpoint**, and no admin screen references it. An admin approving a student today is flag-flipping blind against a document they physically cannot see.

**The Admin Console's existing `/verifications` page is a different thing entirely** — it lists `prisma.verification` records, which are the AI condition checks comparing deposit and return photos on a rental. The naming collision has been hiding this gap.

**STATUS: DONE — deployed and verified end-to-end on the live stack 2026-08-09.**
57/57 assertions pass in `server/node_server/scripts/e2e-verification.mjs`, run against the running API and its real MySQL; the admin page is screenshot-verified in both colour schemes (`docs/design-screenshots/verification/`).

### 3.5.1 Server
- [x] Serve the ID photo to admins — done via the existing signed-token mechanism (`signedMediaUrl(userIdPath(id))`) rather than a new admin-gated route. **Deliberate change from the line below:** a short-lived signed URL is already the pattern for every other sensitive image, and adding a second, role-gated path to the same bytes would have meant two access rules to keep in sync. Access is still admin-only, because only the admin queue endpoint ever mints the token.
- [x] `GET /admin/id-verifications` — queue with the student's submitted data, filterable, **oldest-first**
- [x] `POST /admin/id-verifications/:userId` — decision, reason, reviewer ID, timestamp, in one transaction with the notification
- [x] Reject reasons as a closed set (unreadable / not a student ID / name mismatch / expired / suspected forgery); an unknown reason is a 400
- [x] Notify the student on decision, with the reason if rejected
- [x] `completeProfile` sets `PENDING` — **nothing set this before, so the queue would have been permanently empty no matter how many students signed up**
- **Done when:** approving a student flips `isVerified`, writes a decision record naming the reviewer, and the student is notified. — **met, asserted live**
- ⚠️ **Not done: audit-logging each evidence view.** The decision is recorded; *looking* at someone's ID is not. Carry to Stage 9's audit-log work.

### 3.5.2 Admin: ID verification queue (new page)
- [x] Side-by-side: submitted ID photo next to the registered face photo and the typed name/student number
- [x] Approve / reject with reason; rejection blocked in both UI and API until a reason is chosen
- [x] Filter by pending / approved / rejected / all; decided rows show the timestamp
- [x] **Renamed the existing `/verifications` page to "Condition checks"**
- **Template:** [identity-verification review UI walkthrough](https://ubongabasieka.medium.com/identity-verification-web-application-design-eee5d03a5945) for the side-by-side evidence + decision pattern; queue mechanics per [approve/reject account-request patterns](https://support.higherlogic.com/hc/en-us/articles/10177279816596-Approve-Reject-User-Account-Requests)
- **Done when:** a real pending student can be approved from this page and the app reflects it. — **met**
- ⚠️ **Not done: keyboard-driven review.** Mouse only. Fine at thesis volume, wrong at real volume.

### 3.5.3 App: verification status is visible
- [x] Profile distinguishes not-submitted / under review / approved / rejected, and shows the rejection reason
- [x] Re-submit path after rejection
- **Done when:** a rejected student sees why and can re-submit. — **met at the API level (asserted live); the Flutter screen renders it from the same fields but has not been re-screenshotted on a device since**

### 3.5.4 Three real bugs the verification run found

Worth recording, because two of them were invisible to every API-level check:

1. **Re-submitting kept the old rejection reason.** Status returned to `PENDING` but `verificationReason` was never cleared, so the profile read "Under review" and "the photo was unreadable" simultaneously and the student could not tell whether the new photo had landed. Fixed in `completeProfile`.
2. **The admin console could not display the evidence at all.** `helmet()` sets `Cross-Origin-Resource-Policy: same-origin` globally, and the console runs on a different origin from the API, so every photo was blocked with `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` and rendered as an empty pane — no visible error for the reviewer. Media responses now set `cross-origin` explicitly.
3. **Content type was taken from the path, not the bytes.** Uploads are stored at fixed `.jpg` paths whatever format was sent, and the middleware genuinely accepts PNG and WebP; combined with `nosniff`, a PNG upload was unrenderable. Media now sniffs magic bytes.

**Rule:** bugs 2 and 3 both passed every JSON assertion while making the page useless. A queue endpoint returning a URL is not evidence that a human can see the photo — assert on `naturalWidth > 0` in a browser, not on the URL's presence in a payload.

---

## Stage 3.6 — Admin: item detail, ratings and reviews (NEW)

The Admin Console has an items **list** (`/items/page.tsx`) and nothing else — no detail view. There are also **no admin item or review endpoints at all**; the list is reading the public `/items`. An admin investigating a complaint about a listing cannot see its reviews, its rental history, or its owner's record in one place.

### 3.6.1 Server
- [ ] `GET /admin/items/:id` — full record incl. owner, all photos, rental history, review aggregate
- [ ] `GET /admin/items/:id/reviews` — every review with author, rating, comment, date
- [ ] `PATCH /admin/items/:id` — moderate: unlist, flag, restore
- [ ] `DELETE /admin/reviews/:id` — remove abusive reviews, soft-delete with reason and audit entry

### 3.6.2 Admin: item detail page (new page)
- [ ] Header: title, owner (linked to their user record), category, condition, status
- [ ] Photo gallery, all images not just the cover
- [ ] Pricing: rate, deposit, lifetime earnings
- [ ] Rental history table with outcomes
- [ ] **Ratings panel: average, distribution bars, and the full review list on its own tab/page** — this is the separate reviews view requested
- [ ] Moderation actions with a confirmation stating the consequence
- **Template:** admin detail/moderation layout per [dashboard template patterns](https://adminlte.io/blog/dashboard-templates/); the ratings panel mirrors the phone app's `_RatingSummary` (average + tappable distribution) so both surfaces read the same
- **Done when:** an admin can open any item from the list, read every review, and unlist it, with the action written to the audit log.

---

## Stage 4 — Offline resilience (§2.10.1)

### 4.1 Connectivity awareness
- [ ] `connectivity_plus`; persistent offline banner
- [ ] Every failed request gets a retry affordance — no dead ends
- **Done when:** airplane mode shows the banner and no screen displays a raw error.

### 4.2 Read cache
- [ ] Cache last good browse results, my listings, rentals
- [ ] Show cached data with an "as of" timestamp rather than an empty state
- **Done when:** browse still renders offline, clearly marked stale.

### 4.3 Write queue
- [ ] Queue and replay non-payment writes
- [ ] **Payments and locker actions must never be queued** — replaying either is dangerous
- **Done when:** a review written offline posts on reconnect; a payment attempted offline fails loudly instead.

---

## Stage 5 — In-app messaging (§2.10.1)

### 5.1 Server
- [ ] Conversation + Message models, scoped to a rental
- [ ] Socket.IO delivery (already in the stack)
- **Done when:** two accounts exchange messages in real time.

### 5.2 App
- [ ] Thread list + conversation screen
- [ ] Entry from rental detail and item detail
- [ ] **Attach the transcript to disputes** — this is the reason it ranks above nicer features
- **Template:** [`flutter_chat_ui`](https://pub.dev/packages/flutter_chat_ui) — production-ready, avoids hand-rolling bubbles//pagination
- **Done when:** a dispute shows the conversation to the reviewing admin.

---

## Stage 6 — Date-based availability (§2.10.1, schema change)

### 6.1 Replace the `isAvailable` boolean
- [ ] Availability derived from booked date ranges, not a flag
- [ ] Server rejects overlapping bookings
- [ ] Checkout calendar disables taken dates
- [ ] **Migration must preserve currently-rented items**
- **Done when:** two rentals can be booked for non-overlapping future weeks, and an overlap is refused.

---

## Stage 7 — Listing video (§2.9.2)

- [ ] One optional clip per listing; `video/mp4` is **already allowed** server-side
- [ ] Cap 15s / check `MAX_FILE_SIZE` before fixing the number
- [ ] Muted, tap-to-play, poster frame — never autoplay with sound
- [ ] Listings without a clip must look deliberate
- **Note:** handover condition-evidence video is **out of scope** — it touches the dispute pipeline and the AI check and must not ride along with a cosmetic feature.

---

## Stage 8 — Trust & safety (§2.10.2)

- [ ] Cancellation policy: defined, shown before payment, enforced by tier
- [ ] Damage-protection position stated plainly (even if "the deposit is the cover, capped at X")
- [ ] Surface reputation that acts: owner completion rate, renter on-time return rate
- [ ] Verification status visible to the student, with an ETA
- [ ] Report-a-listing path
- **Reference:** [Sharetribe P2P marketplace trust & safety](https://www.sharetribe.com/how-to-build/peer-to-peer-marketplace/)

---

## Stage 9 — Enterprise hygiene (§2.10.3)

- [ ] **Accessibility pass** — `Semantics` on every icon-only control; screen-reader test on the rental flow
- [ ] Localisation scaffolding + Bisaya/Tagalog
- [ ] Account activity log visible to the user
- [ ] Designed session-expiry path when refresh fails mid-rental
- [ ] **Force-update gate** — for an app that moves money and opens doors
- [ ] Transaction history screen (`GET /payments` is called; nothing displays it)
- [ ] Notification preferences
- [ ] Profile editing beyond payout (`PUT /auth/profile` exists)
- [ ] Extend/shorten a rental — better than the late-fee path, currently the only option

### Admin-side gaps found in the same pass
- [ ] **No admin audit-log viewer.** Actions are logged server-side; no screen reads them back, so "who unlisted this item" is unanswerable from the UI
- [ ] **No admin-side user detail page.** Users are a flat list — no per-user view of rentals, listings, reviews, payouts and verification history in one place
- [ ] **No bulk actions** anywhere in the console; moderating a spam wave means one row at a time
- [ ] **No export.** Reports cannot leave the screen — no CSV for a thesis defence or an audit
- [ ] **No saved filters or column preferences** on any table
- [ ] **Kiosk page is read-only** — no remote "release locker 03" for a stuck door, which is the single most likely support call
- [ ] **No admin role granularity.** Any admin can do anything; a reviewer approving student IDs should not also be able to issue refunds

---

## Cross-cutting: definition of done

No item is ticked until **all** of these hold:

1. `flutter analyze` clean, `tsc --noEmit` clean
2. Verified against the **deployed** API, not a mock
3. Screenshot-verified in **both** themes (mandate §0)
4. Verified at **1.3× text scale and 360px width** (mandate §1.7)
5. Failure path exercised, not just the happy path
6. `memory.md` and the mandate updated

---

## Honest sequencing note

Stages 1–2 are the highest value per hour: observability makes everything after it measurable, and My Listings is mostly wiring against endpoints that already exist. Stages 5–6 are the largest builds and both need schema work. Stage 9 is cheap per screen but expensive if left until every screen exists.
