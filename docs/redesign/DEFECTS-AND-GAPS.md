# DEFECTS-AND-GAPS.md — Reported Defects, Analyzed Against the Real API

These are **user-reported, confirmed-in-use defects**, not audit speculation.
Each is analyzed against the actual endpoint/socket surface in `Implemented.md`
so the fix targets a cause, not a symptom. **Verify each analysis in E0 before
fixing** — these are informed hypotheses from the API surface, not from
reading the failing code.

Priority order: these come **before** cosmetic redesign work. A beautiful
screen that double-prompts for authentication is still broken.

---

## D-1 — Settings double-authenticates; ID/verification status neither shown nor updating

**Reported:** the user is asked to authenticate again in Settings, and the
screen doesn't show current ID/face verification status or update when it changes.

**Likely causes, in order of probability:**
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

**Reported:** rentals only appear as a section on the home dashboard.

**Analysis:** `GET /rentals` (auth) exists and returns the full list. The
home dashboard's rental section is the *only* consumer. This is purely a
missing screen, not a missing capability.

**Fix:** a dedicated My Rentals screen — full history, filterable by status,
grouped (active / upcoming / completed / cancelled), each row opening the
existing rental detail. The home dashboard section becomes a summary that
links into it. **Both renter-side and owner-side rentals need a home** — a
user is both, and `GET /rentals` returns rentals they're party to either way.

---

## D-3 — Users can rent their own items

**Reported:** confirmed possible.

**Analysis:** `POST /rentals` validates auth + verified, but nothing in the
documented surface rejects `item.ownerId === req.user.id`. This is a **real
server-side validation gap**, not just a UI oversight.

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

**Analysis, and this one is frustrating in a good way — the infrastructure
already exists and isn't being used.** `Implemented.md` §3.2 documents a full
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

**Analysis:** `/notifications` endpoints exist (list, preferences, mark-read,
mark-all-read, delete) and `notification_service.dart` consumes them — so
there's a notification *record* system with no *delivery* to the user's
attention. Two separate missing pieces:

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
