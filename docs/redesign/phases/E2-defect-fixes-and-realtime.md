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

> **STATUS RECONCILIATION, 2026-09-11 (P-1).** This file's boxes were never
> ticked as work completed — `docs/PROGRESS.md` was the running record and
> this stayed a plan, so it read as 0/21 done while E2 was recorded
> **COMPLETE 2026-09-07**. Every box has now been checked against the repo
> once, with its evidence. Three states are used deliberately and must stay
> distinguishable: **[x] done**, **[ ] + RULED** (a decision, not an
> omission), and **[ ] + OPEN** (genuinely outstanding).
> `docs/PROGRESS.md` remains authoritative where the two disagree.

---

## E2.1 — D-3 first: self-rental (server-side)
- [x] ~~Reject `item.ownerId === req.user.id` at `POST /rentals`, clear 400~~
      — **DONE.** `rentalController.ts:40-41`: `if (item.ownerId === req.user.userId)`
      throws `ValidationError("You cannot rent your own item")`.
- [x] ~~Fix every other instance E0.2's sweep found (reviews, messaging, etc.)~~
      — **DONE, by the sweep finding nothing else.** `docs/PROGRESS.md` →
      "SELF-ACTION SWEEP (E0.2 / D-6 pattern 2) — **COMPLETE, and it found
      nothing**". There was no second instance to fix.
- [x] ~~Client: owner-context actions on your own item instead of Rent~~
      — **DONE and VERIFIED ON SCREEN both sides 2026-09-07** (`ef69619`):
      own listing reads "Manage your listing", another owner's reads
      "Request rental".

## E2.2 — D-4: the real-time layer
The infrastructure exists and isn't used — this is wiring, not building.
- [x] ~~One app-wide socket manager in Flutter: connect on login, `join` the
      user's room, backoff reconnect, disconnect on logout. **One connection**~~
      — **DONE.** `core/services/socket_service.dart` (singleton). It existed
      but **threw on every connect since 2026-04-24** — that is **D-40**,
      found and fixed in this phase and verified connecting on device.
- [x] ~~Subscribe: `message:new`, rental status events, deposit/return outcomes,
      notifications~~ — **DONE.** `socket_service.dart` subscribes
      `message:new`, `rental:active`, `payment:approved`,
      `verification:approved`, `face:verified` and the `*:completed`
      outcomes.
- [x] ~~**Chat is the reference implementation** — most visibly broken, easiest
      to verify~~ — **DONE.** `socket_service.dart:184` emits `message:new`
      into the stream and `conversation_screen.dart:58` consumes it, with a
      comment naming this as E2.2's other half.
- [x] ~~Admin console: live-update queues (disputes, verifications, feedback)~~
      — **DONE.** The console had no socket client at all; E2.2 added one
      plus the role-gated `admin:join`. Queue events verified against the
      deployed server.
- [x] ~~**Connection state visible** on both; refetch on reconnect to catch what
      was missed~~ — **DONE and VERIFIED ON SCREEN 2026-09-07.**
      `client/admin/src/components/ui/ConnectionIndicator.tsx` rendered
      **LIVE** with an admin token and **NOT SUBSCRIBED** with a student
      token (both paths proven); Flutter side via
      `ConnectivityController`/`OfflineBanner`; reconnect-resync verified.

## E2.3 — D-5: feedback and notifications
- [x] ~~In-app toast/snackbar layer first — every mutating call produces visible
      success/failure. Fast, high value, no backend work~~ — **DONE.**
      `core/utils/toast_utils.dart`, **57 call sites across 13 files**;
      restyled onto design tokens in E3.2 and `showSnackBar` is now **0**
      across `lib/`.
- [ ] Push notifications: **scope explicitly with the human** before building.
      Needs FCM, a device-token store, and must respect the existing
      `/notifications/preferences` endpoint
      — **RULED, NOT AN OMISSION. Deferred to backlog** by prior ruling
      (`docs/PROGRESS.md` → E2.3 row). Left unticked on purpose: this was
      decided against, not forgotten, and ticking it would erase that.

## E2.4 — D-1: verification status
- [x] ~~Settings reads `GET /auth/profile` on focus, not a cached login payload~~
      — **DONE, and met better than specified.** `auth_provider.loadUser()`
      refetches `/auth/profile` (`auth_service.dart:117`) rather than
      patching the cached login payload — the provider's own comment records
      that D-1's cause was `login` omitting the three verification fields
      `getProfile` returns. It is driven by the `verification:approved` /
      `verification:rejected` socket events rather than by a focus hook,
      i.e. it refreshes **on the admin's decision**, not on the next time
      the user happens to look.
- [x] ~~Three distinct states per item (ID, face): not submitted / pending
      review / verified~~ — **DONE.** `home_screen.dart:1202-1250` renders
      `_verifyLabel` / `_verifyColor` / `_verifySubtitle` from
      `verificationStatus` + `isVerified`.
- [x] ~~**New socket event when an admin approves/rejects an ID verification** —
      small justified backend addition; the admin action exists, it just
      notifies nobody~~ — **DONE and VERIFIED END-TO-END 2026-09-07.**
      `adminController.ts:1806` emits `verification:approved` /
      `verification:rejected` to the student's own room, with unit tests
      (`decideIdVerification.test.ts`) and a live socket-client proof
      against the deployed server.
- [x] ~~Never re-prompt for an already-submitted or verified capture~~
      — **DONE.** `home_screen.dart:1250` gates the tile's `onTap` on a
      `switch (user?.verificationStatus)`, so a submitted or approved
      capture has no re-submit affordance.

## E2.5 — D-2: My Rentals
- [x] ~~Dedicated screen: full history, status-filterable, grouped~~
      — **DONE.** `_RentalsTab` in `home_screen.dart:608` is a full
      `Scaffold` screen with its own AppBar ("My Rentals"), a
      `_RentalFilterRail` for status filtering, skeleton loading, pull-to-
      refresh and a stale-data banner. **It lives inside `home_screen.dart`
      rather than its own file** — a code-organisation detail, not a missing
      screen; noted because the file tree makes it look absent.
- [x] ~~Covers both renter-side and owner-side rentals~~ — **DONE, verified
      server-side.** `RentalService.getRentals()` sends no `type`, and
      `rentalController.ts:161-163` then queries
      `where.OR = [{ renterId }, { ownerId }]` — both sides in one list.
- [x] ~~Home dashboard section becomes a summary linking into it~~ — **DONE.**
      `home_screen.dart:334-339` renders a "My rentals" `_SecondaryAction`
      whose `onTap` is `widget.onGoToRentals`.

## E2.6 — Everything else from D-6's sweeps
- [x] ~~Fix every instance enumerated in E0.2, not just the reported five~~
      — **DONE.** All four E0.2 sweeps are recorded complete in
      `docs/PROGRESS.md`: self-action (**found nothing**), mutation-feedback
      (**no significant gap**), stale-state (**one instance, already
      fixed**), socket emit/consume (**5 unconsumed events**, carried into
      this phase).

## Definition of done
- [ ] Every defect in the register fixed **and covered by an E1-style test**
      — **OPEN, and it always was.** E2's *own* defects were fixed and
      tested, but the register is a living document: **14 of 56** are
      closed, and later entries (D-53's kiosk half, D-55, D-56) are open by
      definition. This bullet cannot be satisfied at a phase boundary and
      should arguably have been scoped "every defect *found in E2*".
- [ ] Real-time verified by using two devices simultaneously, not by reading code
      — **GENUINELY OPEN. Never done this way.** Delivery was proven with a
      `socket.io-client` against the deployed server plus one emulator —
      strong evidence that the server emits to the right room and a real
      client receives it, but **not** two human-driven devices side by side.
      Carried forward on the user's ruling 2026-09-11; the two-device test
      also wants the Pi, which is offline.
- [x] ~~Defect register clean or remaining items explicitly deferred with reasons~~
      — **DONE.** E2 closed with **D-37, D-38 and D-39 explicitly deferred,
      each with a written reason and a named destination** (D-37 → E3's
      shared-component pass; D-38 → same; D-39 → scheduled, later fixed,
      deployed and verified live 2026-09-10). That is exactly the escape
      this bullet allows.
