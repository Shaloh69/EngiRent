# DEFECTS-AND-GAPS.md — Reported Defects, Analyzed Against the Real API

> **⚠ CORRECTED 2026-09-06 after E0 verified every entry against the running
> system. Four of the five original analyses were wrong.** The *symptoms* were
> real — they came from actual users — but the causes named below were inferred
> from `Implemented.md`'s endpoint list without opening the client code, and
> that method cannot tell you whether a screen calls an endpoint. Each entry now
> carries its **verified** cause. `docs/PROGRESS.md`'s defect register is the
> live record, including D-7 … D-20 found during E0.
>
> **Scoring:** D-1 wrong cause (and the real one needed two fixes) · D-2 the
> screen already exists · D-3 the layers were inverted · D-4 the infrastructure
> it asks for is already built · D-5 half wrong. Only the push-notification half
> of D-5 survived intact.
>
> **The lesson worth keeping:** an audit of the API surface tells you what the
> server can do, never what the client actually does. Verify against the running
> product before scoping work from a document like this one.


These are **user-reported, confirmed-in-use defects**, not audit speculation.
Each is analyzed against the actual endpoint/socket surface in `Implemented.md`
so the fix targets a cause, not a symptom. **Verify each analysis in E0 before
fixing** — these are informed hypotheses from the API surface, not from
reading the failing code.

Priority order: these come **before** cosmetic redesign work. A beautiful
screen that double-prompts for authentication is still broken.

---

## D-1 — Settings double-authenticates; verification status neither shown nor updating
### ✅ FIXED — but the documented cause below was wrong, twice over

**Reported:** the user is asked to authenticate again in Settings, and the
screen doesn't show current ID/face verification status or update when it changes.

> **VERIFIED CAUSE (2026-09-06).** Not a caching or refetch problem at all.
> **(a)** `UserModel.fromJson` never parsed `verificationStatus` /
> `verificationReason` / `verificationNote`, so every user fell through to the
> `UNSUBMITTED` default and the Identity tile always offered a re-capture.
> **(b)** Fixing that alone did **not** fix the bug — `login` hand-builds its
> user object and omits the same three fields, while `register` and
> `getProfile` return them, so the cached login payload had no state to parse.
> Both fixed and verified on screen: the tile now reads "UNDER REVIEW" and is
> no longer tappable. There was never a stale cache to refetch.
>
> The original speculation is kept below for the record.

**Original (incorrect) speculation, in order of probability:**
1. **The verification state is never read back.** `GET /auth/profile` returns
   the user record; the `User` model backs `isVerified` and the ID/face
   verification state. If Settings renders from a cached login-time user
   object and never refetches, it will show stale state forever.
2. **Verification is asynchronous and nothing tells the app it completed.**
   `/admin/id-verifications` is a real staff-reviewed queue — so ID approval
   happens *later*, by a human, on another surface. There is no socket event
   emitted to the user when their verification is approved. Even a correct
   refetch would only update on manual reload.
3. **"Double authentication" is probably the app re-running
   `POST /auth/register-face` or `/auth/id-photo` because it can't tell
   they're already done** — i.e. a symptom of (1), not a separate bug.

**Fix:**
- Settings reads verification state from `GET /auth/profile` on focus, not
  from a cached login payload
- Show three distinct states per item (ID, face): **not submitted / pending
  review / verified** — pending is a real state here because a human reviews
  it (same PENDING-is-not-failure rule as `ANIMATION-AND-LOADING-SPEC.md` §3)
- **Emit a socket event when an admin approves/rejects an ID verification**,
  and have the app update live. This is a small, justified backend addition —
  the admin action already exists, it just doesn't notify anyone
- Never re-prompt for a capture that's already submitted or verified

---

## D-2 — No separate full "My Rentals"
### ❌ WRONG — the screen already exists and always did

**Reported:** rentals only appear as a section on the home dashboard.

> **VERIFIED (2026-09-06).** `_RentalsTab` is a full bottom-nav tab titled
> "My Rentals", with a status filter rail (All / With me / Upcoming / Past),
> skeleton loading, a designed empty state with a CTA, an error state, a
> stale-data banner, pull-to-refresh, rows opening rental detail, **and** a
> socket subscription that reloads on any rental change. Captured live at
> `design/before/flutter-rentals-tab.png`. Essentially the entire "Fix" section
> below was already shipped. **Build nothing here.**

**Original (incorrect) analysis:** `GET /rentals` (auth) exists and returns the
full list. The home dashboard's rental section is the *only* consumer. This is
purely a missing screen, not a missing capability.

**Fix:** a dedicated My Rentals screen — full history, filterable by status,
grouped (active / upcoming / completed / cancelled), each row opening the
existing rental detail. The home dashboard section becomes a summary that
links into it. **Both renter-side and owner-side rentals need a home** — a
user is both, and `GET /rentals` returns rentals they're party to either way.

---

## D-3 — Users can rent their own items
### ⚠️ INVERTED — the server was never the problem

**Reported:** confirmed possible.

> **VERIFIED (2026-09-06).** The server guard has existed since the **first
> backend commit** (`0e5b05c`) — `rentalController.ts:40` rejects
> `item.ownerId === req.user.userId`. `git log -L` confirms it was never absent.
> The gap is **client-only**: item detail renders an enabled "Request rental"
> CTA with no owner check (`item_detail_screen.dart:474`) while line 370 *does*
> check ownership for the message button. An owner taps through, fills the form,
> and gets a 400. **Do the client half; the server half is already correct.**
>
> The adjacent-path sweep also came back clean — reviews, messaging and refunds
> all derive the counterparty from the rental rather than trusting client input.
> But that safety is *transitive*: it rests entirely on this one line, so E1
> should test the derived-counterparty behaviour directly.

**Original (incorrect) analysis:** `POST /rentals` validates auth + verified,
but nothing in the documented surface rejects `item.ownerId === req.user.id`.

**Fix, both layers — server first:**
- **Server:** reject at `POST /rentals` with a clear 400. This is the
  authoritative fix; do it even if the UI also hides the button
- **Client:** hide/disable the Rent action on an item the viewer owns, and
  show an owner-context action instead (Edit / View bookings)
- **Also check adjacent paths for the same class of bug:** can an owner
  review their own item (`POST /reviews`)? Can they message themselves
  (`/rentals/:id/conversation`)? Same missing-self-check pattern is likely
  to repeat — E1's API test suite should probe for it explicitly

---

## D-4 — Nothing is real-time; the app needs constant reloading

**Reported:** chats and other updates don't arrive without a reload.

> **VERIFIED (2026-09-06).** The app-wide socket manager this entry asks for
> **already exists**: `SocketService` is a singleton, connects on login, joins
> the user's room, has `enableReconnection()`, and subscribes to **13** events.
> **Chat already subscribes** to `message:new` with local-echo de-duplication —
> the nominated "reference implementation" is done. The socket audit found the
> real gaps: **the admin console has no socket client at all** (so its queues
> genuinely cannot live-update), **5 of 21 emitted events have no consumer**,
> and there is **no refetch-on-reconnect** anywhere. Scope E2.2 to those three.

**Original analysis:** `Implemented.md` §3.2 documents a full
Socket.io surface: the server emits `message:new` (from `messageController`),
`rental:completed`, `rental:active`, `deposit:approved`/`rejected`/`retry`,
`return:disputed`/`under_review`/`retry`, `face:verified`/`failed`, and there's
a `join` handler for room membership. **The kiosk flow uses sockets correctly
and works.** The rest of the app apparently doesn't subscribe.

**Fix:**
- A **single app-wide socket manager** in the Flutter app: connects on login,
  `join`s the user's room, reconnects with backoff, disconnects on logout.
  One connection for the whole app, not per-screen
- Subscribe and update local state live for: `message:new` (chat), rental
  status events, deposit/return outcomes, notifications
- **Chat specifically** should be the reference implementation — it's the
  most visibly broken and the easiest to verify
- Same treatment on the **admin console**, which has SSE for kiosk events
  but should also live-update its queues (disputes, verifications, feedback)
  rather than requiring refresh
- **Offline/reconnect state must be visible.** A socket that silently died
  looks identical to "nothing is happening" — show connection state, and
  refetch on reconnect to catch what was missed while disconnected

---

## D-5 — No toasts or notifications on the phone

**Reported:** no in-app feedback, no push.

> **VERIFIED (2026-09-06).** The in-app toast layer — called "the bigger gap of
> the two" below — **already exists**: `AppToast` on `toastification`, four
> types, **57 call sites across 13 files**, covering every mutating screen. The
> per-file sweep found mutations without toasts only in the HTTP/service layers
> (where a toast would be an architecture smell) and in screens with purpose-
> built feedback (forms use inline validation; face-verify deliberately keeps
> failures local). **Push notifications are the only real work in D-5** — no
> FCM, no device-token store, no registration endpoint.

**Original analysis:** `/notifications` endpoints exist (list, preferences,
mark-read, mark-all-read, delete) and `notification_service.dart` consumes them.
Two separate missing pieces:

1. **In-app toast/snackbar layer** — nothing confirms an action succeeded or
   failed. Every mutating call (book, cancel, extend, pay, review, message,
   settings change) should produce visible feedback. This is the bigger gap
   of the two and the cheaper fix
2. **Push notifications** — nothing reaches the user when the app is closed,
   which matters for exactly the events that are time-sensitive: rental
   approved, return due, deposit approved, ID verification approved (D-1),
   new message. This needs FCM wiring plus a token registration endpoint —
   **a real backend addition, so scope it explicitly rather than assuming it**

**Fix:** build the in-app toast layer first (fast, high value, no backend
work), then scope push as its own decision with the human — it needs FCM
setup, a device-token store, and per-event opt-in respecting the existing
`/notifications/preferences` endpoint.

---

## D-23 — The mock-payment fallback dead-ends when starting a transaction
### Reported by the user; partially root-caused 2026-09-06

**Reported:** the temporary PayMongo fallback — the manual-approval path used
while no live key is configured — does not work from the phone when starting a
transaction / paying.

**What is verified in code:**

1. **The phone fails silently.** `rental_detail_screen.dart:130-132` reads
   `paymentUrl` and the transaction id from `POST /payments`, and if **either
   is null it just `return`s** — no toast, no error, no state change. The user
   taps Pay, sees the "Opening Checkout…" info toast, and then *nothing
   happens*. Any server-side problem in this path is invisible by construction,
   which is why it reads as "not working" rather than as an error.
2. **The mock URL depends on `CLIENT_WEB_URL`.** `paymentController.ts:245`
   builds `${env.CLIENT_WEB_URL}/payments/mock?tid=…`. That variable was
   **stale until 2026-09-06** — pointing at the dead 2026-09-03 tunnel — so the
   in-app WebView was loading a hostname that no longer resolved. Fixed as part
   of the tunnel-URL repair, but **any build or session before that fix would
   have shown exactly this symptom.**
3. **`/payments/mock` needs its `tid`.** Without it the page renders *"No tid
   was provided — this page is only meant to be opened from the Phone App's
   checkout WebView"* (captured: `design/before/web-payments-mock-noctx-*.png`).
   So a truncated or mis-parsed URL degrades to a dead-end page rather than an
   error.

**Not yet confirmed, and it needs a real run:** whether the admin-side manual
decision (`POST /admin/transactions/:id/decide-payment`) actually propagates
back to the phone. There is **no socket event for a payment decision** in
`Implemented.md` §3.2's emit list, which means the app has no way to learn the
outcome without a manual refetch — consistent with the report that the flow
"doesn't work" even when an admin approves.

**Fix, in order:**
- **Never fail silently.** Replace the bare `return` with a real error toast
  naming what was missing. This is the one change that would have made the
  original report diagnosable.
- Confirm whether `decide-payment` notifies the app; if not, that is the same
  class as D-1's missing approval event and should be solved the same way.
- Make the mock path unmistakably a *test* payment end to end
  (`TEMPLATE-LINKS.md` already requires this of the page itself).

---

## D-6 — Sweep for the same classes of bug everywhere

The five above share three underlying patterns. E1's API suite and E2's fix
pass should hunt each pattern across **every** screen and endpoint, not just
where it was reported:

| Pattern | Where else to look |
|---|---|
| **Stale cached state never refetched** (D-1) | Every screen showing user/rental/item state that another actor can change |
| **Missing self-action validation** (D-3) | Reviews, messaging, item edit, rental cancel, refund requests |
| **Socket event emitted but nobody listening** (D-4) | Every event in `Implemented.md` §3.2's emit list — check each has a consumer |
| **Mutating action with no user-visible result** (D-5) | Every POST/PUT/PATCH/DELETE the app makes |
