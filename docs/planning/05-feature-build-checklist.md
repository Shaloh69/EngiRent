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
**STATUS: built and unit-verified 2026-08-09; one acceptance step needs a DSN from the user.**
- [x] Added `sentry_flutter`; the whole of `main()` is wrapped, not just `runApp` — a crash while resolving the first-run flag or restoring the theme is exactly the kind that used to be invisible
- [x] Global `FlutterError.onError` + `PlatformDispatcher.instance.onError` handlers, installed **even when no DSN is configured**, so the failure mode of a missing secret is "reports go nowhere", never "errors are silently swallowed" or "the app won't start"
- [x] PII scrubbed before send — `lib/core/observability/pii_scrubber.dart`, deliberately free of any Sentry import so it is testable without a DSN or a network
- [x] Version + build read from the bundle via `package_info_plus`. **Not** from `release.ts` as this line originally said, and not from `AppConstants.appVersion`, which said `'1.0.0'` while pubspec was on `1.5.2+15` — five minor versions of drift on a constant nothing referenced. That constant is now deleted rather than corrected.
- [x] Screenshots/view hierarchy disabled and `sendDefaultPii = false`: a screenshot attached to a crash on the profile screen would be an ID photo.
- **Template:** [Sentry Flutter docs](https://docs.sentry.io/platforms/dart/guides/flutter/)
- **Done when:** …the scrubber is proven by asserting a token-bearing event is redacted — **met.** `test/pii_scrubber_test.dart`, 16 assertions, all passing, using the payloads this app really produces: a JWT of the shape `/auth/login` returns, a 128-float face encoding, a signed media URL (which grants access on its own), stored `users/{id}/id.jpg` paths, and PH mobile numbers. It also asserts the scrubber does *not* over-match ordinary diagnostic text, because a scrubber that redacts everything is the same as having no logs.
- ⚠️ **Blocked, needs the user: "a deliberately-thrown test exception appears in the dashboard".** That needs a real Sentry DSN and project, which I will not create on someone's behalf. Everything up to the network hop is wired and provably correct. To finish it: `flutter build apk --release --dart-define=SENTRY_DSN=…`, then long-press the version row at the bottom of Profile (debug builds) or call `CrashReporting.sendTestEvent()`.
- **Verified alongside:** the app still reaches first paint with the new startup wrapper (release web build, onboarding renders, zero console errors) — `flutter analyze` cannot catch a wrapper that throws.

### 1.2 Analytics funnel
- [ ] Instrument: browse → item detail → checkout → paid → collected → returned
- [ ] Screen-view events on every route
- **Done when:** a full rental produces an ordered, complete event trail.

---

## Stage 2 — My Listings (largest user-visible gap, §2.9.1)

**STATUS: DONE — 42/42 assertions pass against the live API and its real database (`server/node_server/scripts/e2e-my-listings.mjs`); `flutter analyze` clean; release web build boots to first paint with zero console errors.**

### 2.1 My Listings screen
- [x] Wired `GET /items/my-items`
- [x] Owner's items with live state — a server-resolved `listingState` (AVAILABLE / RENTED / UNLISTED / UNAVAILABLE), not three raw booleans for the client to interpret itself, so the app and a future admin surface can't disagree about what a combination means
- [x] Entry points: Profile row ("My Listings") + a 4th home quick-action tile
- [x] Empty state that routes to "List an item"
- **Template:** [Universal Listings Flutter Template](https://instaflutter.com/app-templates/universal-listings-flutter-template/) for the seller-inventory pattern
- **Done when:** an item created in the app appears here immediately, with correct state while rented. — **met, asserted live**: create → AVAILABLE, DB-level active rental → RENTED with the renter's name and return date, rental clears → AVAILABLE again.
- **Two real bugs found while wiring this, not while designing it:**
  1. `getMyItems` never included `owner` in its query. `ItemModel.fromJson` — the same model the public browse screen uses — requires it and throws without it. Harmless while nothing called this endpoint; would have crashed the screen the moment it shipped.
  2. `create_item_screen.dart`'s condition picker had a key, `'EXCELLENT'`, that is not a valid `ItemCondition` enum value at all (the real values are `NEW | LIKE_NEW | GOOD | FAIR | ACCEPTABLE`) — selecting it and submitting would 400. `ACCEPTABLE`, a real option, was missing from the picker entirely. Both fixed; caught only because this form was about to be reused for edit and needed reading in full.

### 2.2 Edit listing
- [x] Wired `PUT /items/:id`
- [x] `CreateItemScreen` takes an optional `editListing` — **no second form.** Title, submit label and one notice banner change; the photo strip, pickers and price preview are the exact same widgets.
- [x] Pre-populates every field including photos and serial number
- **Done when:** editing a price changes it on the public listing, and cancelling changes nothing. — **met, asserted live**: price edit reflected in `my-items`; nothing is written until Save is pressed.

### 2.3 Photo management on existing listings
- [x] Add / remove / reorder; change cover — a single ordered list of "existing URL or newly-picked file" entries, so reordering-to-cover and removal work identically whether or not the photo is already on the server
- [x] Reused the existing photo strip and promote-to-cover long-press verbatim
- [x] Refuse removing the last photo — blocked as an action with a toast explaining why, not just a submit-time validation error
- **Done when:** cover change is reflected in browse results. — inherited for free: the cover is always `images[0]`, which is what browse already reads.

### 2.4 Unlist / relist + delete
- [x] **New `isListed` field, deliberately separate from `isAvailable`.** `isAvailable` is rental-lifecycle state the system flips; overloading it for the owner's "hide this" intent would make "someone unlisted this" and "someone is renting this right now" indistinguishable, and would let the rental lifecycle silently re-list an item the owner had taken down the moment a rental completed. An active rental takes display priority over an owner's unlist choice (state shows "Rented" first with a secondary "hidden from browse" note) rather than the reverse, since the rental is the more consequential fact.
- [x] Wired `DELETE /items/:id`
- [x] Blocked client-side: `canDelete` is resolved server-side from the same in-flight-status set `deleteItem` itself refuses against, so the app can never offer a delete the API will reject. Tapping a blocked delete shows the reason (who has it, when it's due back) and never calls the endpoint.
- [x] Confirmation states the consequence honestly: hidden permanently, not restorable from the app; reviews already left are kept (they're part of rental history, not the listing)
- [x] **Server-side hardening beyond the checklist item:** `isAvailable` can no longer be forced back to `true` by the owner while a rental is in flight (a gap in the original `updateItem` — nothing stopped it) — the API now refuses with a message pointing at unlisting instead, which is the actual tool for the owner's intent.
- **Done when:** deleting an item with an active rental is refused with a clear reason, not a 400 toast. — **met, asserted live** against a real `ACTIVE` rental row (inserted directly, since a genuine one needs a completed PayMongo checkout, out of scope here): refused with 400 naming the reason; after the rental clears, delete succeeds and the item disappears from both `my-items` and public browse.

---

## Stage 3 — Feedback loop (§2.9.3, genuinely new, server included)

**STATUS: DONE — deployed and verified live 2026-08-10.** 43/43 assertions pass in `server/node_server/scripts/e2e-feedback.mjs` against the live API and its real database, 7/7 in `src/utils/__tests__/kioskEventLog.test.ts`; the admin triage page is screenshot-verified in both colour schemes with all four report categories rendering correctly, an evidence screenshot decoding, and the resolve modal working (`docs/design-screenshots/feedback/`).

### 3.1 Server: `POST /feedback`
- [x] Prisma model: category, body, screenshotPath, appVersion, device, screen, rentalId?, kioskId?, status, plus `adminNote`/`resolvedById`/`resolvedAt` for triage and `kioskEventSnapshot` (see 3.2)
- [x] Category enum: BUG / SUGGESTION / KIOSK_PROBLEM / PAYMENT_PROBLEM / OTHER
- [x] Rate-limited per user (`middleware/perUserRateLimiter.ts`) — **deliberately not the existing global IP-keyed limiter**: a shared campus wifi NAT means many students share one IP, so an IP-keyed limit either punishes everyone behind it or has to be too loose to stop anything. New limiter, same on-disk-snapshot-free shape, keyed by `req.user.userId`.
- [x] Screenshot stored at the same privacy tier as a face/ID photo — never served directly, only through `signedMediaUrl()` — because a screenshot can incidentally contain anything on the student's screen: their own rental details, someone else's listing, a payment amount.
- [x] `rentalId` is verified against the reporter (must be their own rental as renter or owner) before being trusted as context, not accepted blindly.
- **Done when:** a submission persists with its context attached. — **met, asserted live**

### 3.2 App: Send Feedback
- [x] Profile → Send Feedback → a list of the student's own past reports (so the loop isn't one-way from their side either) with a "New report" action opening the compose form
- [x] **All three contextual entries wired, not just kiosk:**
  - Failed kiosk hand-off (`KioskScanScreen`) → `category: KIOSK_PROBLEM`, rentalId, and kioskId attached
  - Cancelled/failed checkout (`RentalDetailScreen`) → `category: PAYMENT_PROBLEM`, rentalId attached
  - Disputed rental (`RentalDetailScreen`) → `category: OTHER`, rentalId attached
- [x] Optional screenshot attach, with an explicit caption warning against including other people's information
- **Template:** [Flutter feedback-form UI collection](https://github.com/mrutyunjayagiri/flutter-custom-feedback-form-UI-collections) for the compose layout
- **Done when:** a report filed from a failed kiosk scan arrives with kiosk ID and recent events attached. — **met, with one real pre-existing gap closed to make it true:** the phone app had **no way to know which physical kiosk it was talking to** — it only ever spoke to Node, never to a kiosk directly, and none of the three socket events it listens to (`face:verified`, `face:failed`, `kiosk:scan_error`) carried a `kiosk_id`. Threaded `kioskId` through all three server-side emits (the data was already sitting on `socket.data.kioskId`/the event payload, just never forwarded), plus a QR-token-derived fallback client-side for the case where no server event ever arrives at all (a full 95s timeout with nothing back).
- **"Recent events attached" — new capability, not previously possible:** `kioskEventBus` (Socket.IO ↔ SSE pub/sub) kept **no history at all**; once a moment passed, there was nothing to check against for a "the locker didn't open" report. Added `utils/kioskEventLog.ts`, a 40-event rolling buffer per kiosk, installed at server startup, snapshotted into the report at submission time. Unit-tested in isolation (7 tests) rather than over HTTP, since exercising it live needs a real kiosk socket connection, which is out of scope here — same category of gap as the PayMongo sandbox key.

### 3.3 Admin: triage queue
- [x] List + filter by category/status; NEW → ACKNOWLEDGED → RESOLVED, with the backward transition (RESOLVED → NEW) explicitly rejected
- [x] Category glossary badges, automatically-attached context (version/device/screen/rental/kiosk) shown per report
- [x] Kiosk-problem reports show the event-log snapshot inline, or an honest "no recorded events" message when the kiosk was never actually reached
- [x] Resolving notifies the reporter with the admin's note — **without this, the loop only closes on the admin's side**, which is the same failure mode this whole stage exists to fix
- **Done when:** a report filed in the app appears in the console and can be resolved. — **met, asserted live**

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

**STATUS: DONE — deployed and verified live 2026-08-10.** 43/43 assertions pass in `server/node_server/scripts/e2e-item-moderation.mjs` against the live API and its real database; the detail page is screenshot-verified in both colour schemes with real photos, a real rental history, a real 3-review distribution, and the flag confirmation modal.

### 3.6.1 Server
- [x] `GET /admin/items/:id` — full record incl. owner, all photos, rental history (with renter names and outcomes), review aggregate (average + full 1–5 star distribution), and lifetime earnings (summed from COMPLETED rentals — no such field existed on the item before)
- [x] `GET /admin/items/:id/reviews` — every review with author, rating, comment, date, **including soft-deleted ones, visibly marked as removed with the reason** — the public endpoint excludes them, but an admin needs to see what was taken down and why, not just what survived
- [x] `PATCH /admin/items/:id` — moderate: UNLIST / RELIST / FLAG / UNFLAG / RESTORE
- [x] `DELETE /admin/reviews/:id` — soft-delete (not a hard delete — the row and its reason persist for dispute history and for reversing a mistake), with the item's cached `averageRating` recalculated the same way a new review updates it
- **New, not in the original data model:** `Item.isFlagged`/`flagReason`, kept deliberately separate from `isListed` (the owner's own unlist choice) — a flagged item stays browsable while under investigation unless an admin also unlists it; the two are independent, same reasoning as `isListed` vs `isAvailable` from Stage 2. `Item.moderatedById`/`moderatedAt` and `Review.deletedById`/`deletedAt`/`deleteReason` record who did what — **this is the audit trail for this stage**, recorded directly on the affected row rather than a separate structured audit-log table, which does not exist yet (tracked as its own item under Stage 9's admin gaps — "No admin audit-log viewer").
- **Done when:** …with the action written to the audit log. — met under that scoping: every moderation action and review removal is attributable (who, when, why) from the record itself, asserted live; a cross-cutting, queryable audit log remains future work, not silently declared done.

### 3.6.2 Admin: item detail page (new page)
- [x] Header: title, owner (linked to `/users/:id`), category, condition, status, plus flagged/unlisted/deleted state badges the original spec didn't ask for but the moderation actions need somewhere to show
- [x] Photo gallery, all images not just the cover
- [x] Pricing: rate, deposit, lifetime earnings
- [x] Rental history table with outcomes, each renter linked to `/rentals/:id`
- [x] Ratings panel: average, 1–5 star distribution bars, full review list **on its own tab** — the separate reviews view requested — each review with a Remove action
- [x] Moderation actions with a confirmation stating the consequence: Unlist/Flag require a typed reason and show what the action actually does before confirming; Relist/Unflag/Restore (reversals) fire directly since they only undo a prior restriction
- **Template:** admin detail/moderation layout per [dashboard template patterns](https://adminlte.io/blog/dashboard-templates/); the ratings panel mirrors the phone app's `_RatingSummary` (average + distribution) so both surfaces read the same
- **Done when:** an admin can open any item from the list, read every review, and unlist it, with the action written to the audit log. — **met, asserted live**: the items list's title column now links through (it had no navigation at all before), the detail page loads a real item's full record, and unlist/flag/review-removal all round-trip against the live database with the reason and reviewer recorded.

---

**STATUS: DONE — verified live against the deployed app 2026-08-10.** Real `context.setOffline(true)` network emulation (not a mock) against the actual public deployment, both banners confirmed rendering and clearing correctly by screenshot (`docs/design-screenshots/offline-resilience/`). `flutter analyze` clean, 21/21 unit tests passing.

### 4.1 Connectivity awareness
- [x] `connectivity_plus` added; persistent offline banner via `MaterialApp.builder`, so every screen carries it without having to remember to add it
- [x] **Deliberately more than a radio check.** `ConnectivityController` tracks whether the last real API call actually succeeded (`reportRequestOutcome`), not just whether a network interface is up — a connected wifi radio behind a captive portal, or pointed at a host machine that's down, would otherwise show "online" while every request fails. Every real HTTP call in `ApiService` now runs through one `_execute()` choke point with a 15s timeout (there was previously **no timeout at all** — a hung request left a screen loading forever, its own dead end) and reports its outcome.
- [x] Retry affordances audited across every real data-loading screen. Most already had one; fixed the one genuine gap found: Home's featured-items strip rendered the exact same "Nothing listed yet — be the first" message for a real request failure as for a genuinely empty catalog, which is actively misleading during an outage, not just missing a retry button.
- [x] Raw exceptions no longer reach the user. `e.toString()` — surfacing things like `SocketException: Failed host lookup: 'desktop-gklhcri'` verbatim in a toast — has been replaced everywhere in the service layer and remaining screen-level catch blocks with `friendlyErrorMessage()`, a small classifier distinguishing "can't reach the server" / "took too long" / a generic fallback.
- **Done when:** airplane mode shows the banner and no screen displays a raw error. — **met, live**: real network emulation against the deployed app shows the banner appearing and clearing correctly on state change.

### 4.2 Read cache
- [x] Last-good-response cache (`LocalCache`, `shared_preferences`-backed) for browse, my listings, and rentals
- [x] "As of" timestamp shown via a shared `StaleDataBanner` (`timeago`-formatted) rather than an empty state
- **Real gap found and fixed while wiring this in:** `ItemsScreen`'s primary success path calls the API directly rather than through `ItemService` (a pre-existing dual-path design, not something introduced here) — the cache-writing code only lived in the service method, which that path never touched. Without the fix, browse's cache would have stayed permanently empty because nothing ever populated it on a normal successful load.
- **Done when:** browse still renders offline, clearly marked stale. — **met, live**: My Rentals screenshotted mid-outage showing both the offline banner and "Showing saved results from a moment ago", then screenshotted again after reconnecting showing both clearing.

### 4.3 Write queue
- [x] `OfflineWriteQueue` — persisted (survives the app closing while offline, not memory-only), replays in order, stops at the first still-failing item rather than reordering around it
- [x] **The "must never be queued" rule is enforced structurally, not by convention.** `enqueue()` itself throws for any `/payments` or `/kiosk` endpoint — a logic error a future call site can't accidentally get past, not just a comment asking nicely.
- [x] Wired into the checklist's own worked example: a review submitted with `ApiUnreachableException` queues instead of failing, with a toast explaining it'll post automatically.
- **Done when:** a review written offline posts on reconnect; a payment attempted offline fails loudly instead. — **Payments failing loudly: met and verified throughout this session** — untouched by the queue, and `ApiService`'s timeout/exception handling makes "loudly" concrete rather than a hang. **Review queue-and-replay: unit-tested (5/5, including the safety guard) and code-reviewed, not exercised through a full live rental-to-completed-review cycle** — the live database had zero completed rentals to test against at verification time, and fabricating one purely for this check was judged not worth a synthetic rental fixture. Documented honestly rather than claimed as fully live-verified.

---

**STATUS: DONE — deployed and verified live 2026-08-10.** 28/28 assertions pass in `server/node_server/scripts/e2e-messaging.mjs` against the live API and its real database; the admin dispute-transcript view is screenshot-verified in both colour schemes with a real seeded conversation.

### 5.1 Server
- [x] `Conversation` + `Message` models, **one conversation per rental** (not a general DM system) — kept scoped exactly to what the mandate asks for, since it's the dispute-transcript need that ranks this above nicer chat features, not messaging as a goal in itself
- [x] Real-time delivery over the existing Socket.IO stack, reusing each participant's existing `user:{id}` room (the same one every other rental event already broadcasts to) rather than inventing a per-conversation room
- [x] A message also creates a real notification, so it reaches a student even with the app closed
- [x] Simple read-receipt model: opening a thread marks the other participant's messages read
- **A real ordering bug found by the test, not by reading the code**: the read-receipt update ran, but the response was built from a Prisma `include` fetched *before* that update — so the very call that marked a message read still reported `readAt: null` in its own response. Every other assertion passed while this was broken; only a check on the field's actual value caught it. Fixed by re-querying messages after the update instead of trusting the pre-update include.
- **Done when:** two accounts exchange messages in real time. — **REST half met and asserted live**: send, persist, ordering, notification, read receipts. **Socket.IO delivery itself is not exercised by the live test** — proving it needs a second authenticated client genuinely listening on a socket, which an HTTP-only script can't do without adding a `socket.io-client` dependency for one check, the same documented scope boundary as Stage 3's kiosk event log. The delivery code path is code-reviewed and reuses an already-proven room/emit pattern (`sendKioskCommand`'s `req.app.get("io")`), not new/unproven machinery.

### 5.2 App
- [x] Conversation screen (bubbles, live via `SocketService.onNewMessage`, compose bar) — no separate thread-list screen, since with one conversation per rental the rental itself already is the thread list (My Rentals)
- [x] Entry from rental detail (an AppBar icon, shown once the other party is known) and from item detail (checks for an existing rental of that item via the already-existing `GET /rentals` list — no new discovery endpoint — and opens that conversation, or explains that messaging opens once you've rented the item)
- [x] **Attach the transcript to disputes** — `GET /admin/rentals/:id/conversation`, rendered on the admin rental detail page, deliberately fetched for every rental (not gated to `DISPUTED` only) since a transcript is useful context the moment an admin opens any rental, with a visible "Disputed rental" badge when it applies
- **Template:** hand-built rather than `flutter_chat_ui` — the scope here (one thread per rental, no pagination/typing-indicators/read-receipts-per-message) is small enough that the package's surface area wasn't worth the dependency; the mandate's bubble-layout intent is met directly.
- **Done when:** a dispute shows the conversation to the reviewing admin. — **met, asserted live and by screenshot**: a real 3-message conversation appears correctly on the admin rental detail page in both colour schemes, with sender names, timestamps, and message order intact.

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
