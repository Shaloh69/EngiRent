# E2 — Defect Fixes and the Real-Time Layer

**Goal:** fix what's actually broken, before any cosmetic work. A beautiful
screen that double-prompts for auth is still broken.

## How E2's UI work relates to E3 and E5 — read this first, it prevents a double build

This phase builds three things that later phases also mention: the **toast
layer**, the **connection-state indicator**, and the **My Rentals screen**.
That is deliberate, not duplication. The split:

- **E2 builds them to work.** Correct behaviour, real endpoints, real socket
  wiring. Style them with whatever the app currently uses — E3's tokens don't
  exist yet.
- **E3 restyles them onto tokens** and promotes toast + connection indicator
  into shared components. It does not rebuild their behaviour.
- **E5 runs My Rentals through the full screen process** (template row →
  template shot → impl shot → register). Its *behaviour* is already done here.

**The template gate still applies to anything built in this phase.** All three
have rows in `TEMPLATE-LINKS.md` already. Capture the template screenshot when
you build them here; the implementation shot gets captured (or recaptured)
in E3/E5 after restyling. A screen built in E2 with no template row is
`FAILED` on the same terms as one built in E5.

## E2.1 — D-3 first: self-rental (server-side)
- [ ] Reject `item.ownerId === req.user.id` at `POST /rentals`, clear 400
- [ ] Fix every other instance E0.2's sweep found (reviews, messaging, etc.)
- [ ] Client: owner-context actions on your own item instead of Rent

## E2.2 — D-4: the real-time layer
The infrastructure exists and isn't used — this is wiring, not building.
- [ ] One app-wide socket manager in Flutter: connect on login, `join` the
      user's room, backoff reconnect, disconnect on logout. **One connection**
- [ ] Subscribe: `message:new`, rental status events, deposit/return outcomes,
      notifications
- [ ] **Chat is the reference implementation** — most visibly broken, easiest
      to verify
- [ ] Admin console: live-update queues (disputes, verifications, feedback)
- [ ] **Connection state visible** on both; refetch on reconnect to catch what
      was missed

## E2.3 — D-5: feedback and notifications
- [ ] In-app toast/snackbar layer first — every mutating call produces visible
      success/failure. Fast, high value, no backend work
- [ ] Push notifications: **scope explicitly with the human** before building.
      Needs FCM, a device-token store, and must respect the existing
      `/notifications/preferences` endpoint

## E2.4 — D-1: verification status
- [ ] Settings reads `GET /auth/profile` on focus, not a cached login payload
- [ ] Three distinct states per item (ID, face): not submitted / pending
      review / verified
- [ ] **New socket event when an admin approves/rejects an ID verification** —
      small justified backend addition; the admin action exists, it just
      notifies nobody
- [ ] Never re-prompt for an already-submitted or verified capture

## E2.5 — D-2: My Rentals
- [ ] Dedicated screen: full history, status-filterable, grouped
- [ ] Covers both renter-side and owner-side rentals
- [ ] Home dashboard section becomes a summary linking into it

## E2.6 — Everything else from D-6's sweeps
- [ ] Fix every instance enumerated in E0.2, not just the reported five

## Definition of done
- [ ] Every defect in the register fixed **and covered by an E1-style test**
- [ ] Real-time verified by using two devices simultaneously, not by reading code
- [ ] Defect register clean or remaining items explicitly deferred with reasons
