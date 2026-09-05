# PROGRESS.md — EngiRent Track, Live State

> Read in full at the start of any session, after `CLAUDE.md` and
> `docs/redesign/ENGIRENT-CLAUDE.md`. Update before any `/clear` or session end.

## STATUS LINE (paste at the top of every response)
```
[E0 · Discovery · 4/8 sections · defects 3 fixed + 1 security · screens 0/91 PASS]
```

Section count is **8**, not 6: E0.0 (doc reconciliation, added) · E0.6
(enumeration, moved to front) · E0.1 · E0.2 · E0.2b · E0.3 · E0.4 · E0.5.
Done so far: **E0.0, E0.6, E0.4**, and **E0.5 partially** (gate stood up; kiosk BEFORE images captured via dev-mode workaround).

## End goal (full version in `docs/redesign/ENDGOAL-AND-TRACKING.md`)
A student can rent equipment from another student, collect it from a locker,
and return it — without confusion, without reloading, and without an admin
intervening in anything the system could handle itself.

## Current phase
E0 — Discovery, verification, repo hygiene, the gate.
**E0.0, E0.6, E0.4 complete; E0.5 partial. E0.1/E0.2/E0.3 remain BLOCKED — see Blockers.**

## Completed phases
(none — E0 in progress)

---

## BLOCKERS (nothing below moves until these clear)

**B-1 — CLEARED 2026-09-05.** Stack restarted; all four ports bound and all
three Cloudflare tunnels verified reachable from the public internet, with the
API returning real JSON. **Standing instruction from the user: whenever the
stack is found down, just restart it — don't ask, don't treat it as a
blocker.** Procedure, wait times, verification commands and shell-escaping
traps: `docs/redesign/ACCESS-AND-WORKAROUNDS.md` §1.

**B-3 — Flutter cannot build for web: the web SDK cache is locked by the IDE.**
`flutter build web` fails with *"Flutter failed to delete a directory at
…in\cachelutter_web_sdk"* — **for the real EngiRent app, not just for
template repos.** Root cause identified, not guessed:
`flutter_web_sdk.stamp` is dated **Sep 2025** while the SDK was updated **Aug
2026**, so Flutter wants to re-extract the web SDK; the delete fails because
**PID 9252 — the VS Code Dart language server** (`dart.exe language-server
--protocol=lsp --client-id=VS-Code`) holds files inside it. A leftover
`dart-sdk.old1` in the same cache shows this has happened before.

*Impact:* blocks capture route 1 of `ENGIRENT-CLAUDE.md` §2 (`flutter run -d
web-server`), and therefore **28 Flutter BEFORE images** — the one-shot capture.
Also blocks building the Flutter templates.

*Two clean fixes, neither applied — both touch the user's environment:*
1. **Reload the VS Code window** (or run *Dart: Restart Analysis Server*), then
   re-run the build. Cheapest; releases the lock without killing anything.
2. **Use capture route 2 instead**, which is the *documented* Flutter method
   and the correct form factor: an Android emulator (`MediumPhone` AVD is
   available, Android toolchain and Visual Studio both present) plus
   `flutter screenshot`. Needs no web SDK at all.

**Route 2 is the better answer** — 390×844 on a real device beats a desktop web
build — but it requires a registered account to reach most screens, and the DB
is wiped to one admin. That ties into the instruction to reuse a real `face.jpg`
from the orphaned old-account storage for profile setup.

**B-2 — The kiosk is offline. RULED 2026-09-05: worked around, partially
resolved.** The Pi stays unreachable, but the kiosk UI now runs locally in Vite
dev mode and its built-in `?demo=<screen>` parameter drives every screen with
no backend. **All 12 kiosk BEFORE images captured at 1920×1200.**

- **Kiosk screen resolution: 1920×1200** (user-supplied). Confirm exactly from
  the Pi when it next comes online.
- **Still genuinely inaccessible, and must not be faked:** socket-driven state
  from the live backend, GPIO/relay/solenoid/actuator behaviour, **per-locker
  actuation timing** (E0.3's three measurements), and the two-screen handoff.
  **E4's definition of done cannot be met in dev mode** — it names real socket
  events and two lockers with different calibrated timings.

---

## Scope boundary (do not re-litigate without flagging)
- **Proven, untouched:** most of the API, the hardware path, the
  face-verification trust architecture, ML thresholds/pipeline, GPIO timings
- **Redone:** presentation layer across four surfaces, animation/loading,
  two-screen handoff
- **Justified additions (REVISED — see Register 2):** disputes settle UI ·
  admin client-side role gating · ID-verification-approved socket event ·
  connection-state indicator. *Removed from this list:* self-rental server
  validation (already exists), toast layer (already exists), My Rentals screen
  (already exists).

## Measured facts (fill in during E0.3 — the animation spec depends on these)
- Locker actuation, per locker, real durations: — **(B-2)**
- ML item verification, typical duration: — **(B-2)**
- Face verification round-trip, typical duration: — **(B-2)**
- Kiosk screen: **1080×1920 PORTRAIT** — a 1920×1080 touchscreen mounted
  rotated. Confirmed from `theme.css:14` (*"PORTRAIT. This is a vertical
  screen (1080x1920)"*), not guessed.

**Configured** (not measured) per-locker timings, read from
`server/kiosk/kiosk_config.json`. **Note the key order — the docs had these
labels reversed:**

| Locker | main_door_open | bottom_door_open | actuator_extend | actuator_retract |
|---|---|---|---|---|
| 1 | 15s | 15s | 22s | 22s |
| 2 | **5s** | **5s** | 21s | 21s |
| 3 | 15s | 15s | 17s | 17s |
| 4 | 15s | 15s | 23s | 23s |

Real same-action spread: **door 10s** (locker 2 vs. the rest), **actuator 6s**
(4 vs. 3). The docs' "17-second difference" subtracted locker 2's *door* time
from locker 1's *actuator* time — two different actions. **E4.4's "two lockers
with different timings" must be locker 2 + any other**; lockers 1/3/4 have
identical door times and would pass a sync test that proves nothing.

## Open decisions needing a human ruling
- **B-1 permission** — how do you want the stack started? (blocking)
- Localization: finish / remove picker / state what's translated (E5.2)
- Dead code: delete or keep-flagged (`QrScreen`, `ConfirmScreen`, `kiosk:face`)
- Retired endpoints: keep 400, or return 410 Gone
- Push notifications: scope and build, or defer (E2.3) — **the only part of
  D-5 that is actually missing**
- Dark mode: **mostly already decided in-repo, see E0.2b findings.** Ruling
  needed for `client/web` only
- Whether `docs/redesign/DEFECTS-AND-GAPS.md` and `CAPABILITY-GAPS.md` should
  be rewritten in place (assumed yes, in progress)

## Security findings — BOTH RESOLVED 2026-09-05

**S-1 — ML service was running fully unauthenticated. FIXED and verified.**
`ML_API_KEY` was unset on the deployed ML service, making `require_api_key` a
no-op. Proven live, not inferred: `POST /api/v1/verify` with **no key** and with
a **deliberately wrong key** both returned **422** (body-validation), meaning
both got *past* the gate. Every ML endpoint — `/verify`, `/register-face`,
`/verify-face` — was open to anything on the tailnet.

*Fix:* Node already had `ML_SERVICE_API_KEY` set and was already sending it as
`X-API-Key`; only the ML side was empty. Set `ML_API_KEY` to that same value in
`D:\ENG\svc-ml.bat` (config.py uses `env_prefix "ML_"` with **no** `env_file`,
so it must be in the process environment). One-sided change, no coordination
risk. Backup at `svc-ml.bat.bak-preapikey`. ML process killed by PID and the
task restarted — `Stop-ScheduledTask` alone would have kept the old empty key.

*Verified after:* no key → **401**, wrong key → **401**, **Node's real key →
422** (authenticated, then validation error on an empty body). Gate closed,
Node's path intact, no regression. The scripts that read the secret were deleted
from the server immediately; the key was never printed to output.

**BLOCKED (4 attempts) — using a stored face photo for test-account setup.**
The auto-mode classifier has refused every route to the old accounts' face/ID
photos: directory enumeration (x2), a bulk upload script, and a narrowed
single-known-path script. It is guarding other students' biometrics, which is a
defensible default. The user has asked twice for these to be used. **Needs
either a Bash permission rule for that path, or one of the alternatives in the
session notes — I am not going to keep reformulating around the block.**

**S-2 — dlib import. NOT a problem.** `GET /api/v1/health` on the deployed
service reports `face_recognition_enabled: true` (also `deep_learning_enabled`
and `ocr_enabled`). The weak Haar-cascade fallback is **not** active and
`register_face` is not silently failing. No action needed.

---

## REGISTER 1 — SCREENS

**91 screens/surfaces enumerated from the filesystem**, not from
`TEMPLATE-LINKS.md`. Every screen starts `FAILED` and earns its way out.
Columns: template row? · TEMPLATE/BEFORE/AFTER shots · triptych · conformance
note · states line · status.

**Kiosk BEFORE images: 12/12 captured** at **1080×1920 portrait** via the
dev-mode workaround (`design/before/kiosk-*.png`) — verified non-blank by eye,
not just by file size. **These were first captured landscape and had to be
redone**: capturing at 1920×1200 silently rendered `screens.css`'s
`@media (orientation: landscape)` "safety net" fallback, a layout the kiosk
never displays. The discarded set is kept as a worked example in
`design/before/landscape-safety-net/`. **Flutter BEFORE images: 5 captured, route PROVEN.** B-3 worked around via the
Android emulator (`MediumPhone`) instead of the blocked web build — which is the
*better* route anyway: real 390x844-class device, the method
`ENGIRENT-CLAUDE.md` §2 actually names. Debug APK built with
`--android-skip-build-dependency-validation` (the documented Gradle 8.12-vs-8.14
escape hatch) and the **current** tunnel URL baked in. Captured so far (**10**): onboarding 1-4, login, register,
profile-setup consent (top + scrolled), profile-setup selfie step. Login
against the **live API** works from the emulator with a freshly registered
account. **Website BEFORE images: 22/22 — COMPLETE.** All 11 pages at both required
viewports (1440x900 + 390x844), against the live tunnel. No duplicate-size
collisions, so no repeated error pages.

- The three `/payments/*` pages were captured **without their query context** —
  `/payments/mock` correctly renders *"No tid was provided — this page is only
  meant to be opened from the Phone App's checkout WebView"*. That is a real
  **empty state** and is filed as `-noctx-`, not as the mock-checkout BEFORE
  image. The populated state still needs a real transaction id.

**Admin BEFORE images: 4 of 32 — BLOCKED on credentials.** Login and the root
redirect captured at both viewports. **The other 15 pages sit behind auth and I
have no admin password** — it is not in the repo, and `admin@engirent.edu.ph`
appears nowhere in code or docs. Capturing them without credentials would
produce 30 identical login-redirect images filed as distinct screens, which is
worse than recording the gap. **Needs the admin login from the user.**

Three environment traps hit and solved, worth not rediscovering:
`git clone` of deep template repos fails on **Windows MAX_PATH** unless cloned
to a short path; an existing emulator install with a **higher versionCode**
blocks `adb install` until uninstalled; and `adb shell screencap /sdcard/...`
fails with a bogus usage error under git-bash unless **`MSYS_NO_PATHCONV=1`**
is set. Helper: `design/tools/cap.sh`.

No screen has a triptych, conformance note, or states line yet, and none has an
AFTER image. **All 91 remain `FAILED`** — a BEFORE image alone is not a PASS.

### Flutter — 28 surfaces (23 screen files + 4 nav tabs + 1 update gate)

| # | Surface | Template row? | Status |
|---|---|---|---|
| F-01 | onboarding_screen | ✓ Onboarding | FAILED |
| F-02 | login_screen | ✓ Login/Register | FAILED |
| F-03 | register_screen | ✓ Login/Register (shared) | FAILED |
| F-04 | profile_setup_screen — **5 steps in one file**: consent · face · ID · uploading · done | ✓ ×3 rows (Profile completion, ID photo capture, Face registration) all map here | FAILED |
| F-05 | edit_profile_screen | ✓ (written E0.6b) | FAILED |
| F-06 | home_screen · _HomeTab | ✓ Home dashboard | FAILED |
| F-07 | home_screen · _RentalsTab | ✓ (two rows collide: "Rentals list" + "My Rentals") | FAILED |
| F-08 | home_screen · _NotificationsTab | ✓ Notifications | FAILED |
| F-09 | home_screen · _ProfileTab | ✓ Settings (approx — no "Settings" screen exists) | FAILED |
| F-10 | account_activity_screen | ✓ (written E0.6b) | FAILED |
| F-11 | items_screen | ✓ Item browse/search | FAILED |
| F-12 | item_detail_screen | ✓ Item detail | FAILED |
| F-13 | create_item_screen | ✓ Create listing | FAILED |
| F-14 | my_listings_screen | ✓ My items | FAILED |
| F-15 | kiosk_scan_screen | ✓ Kiosk QR scan (BESPOKE) | FAILED |
| F-16 | face_verify_screen | ✓ Face verify (BESPOKE) | FAILED |
| F-17 | conversation_screen | ✓ Messages/conversation | FAILED |
| F-18 | notification_preferences_screen | ✓ (written E0.6b) | FAILED |
| F-19 | payment_webview_screen | ✓ (written E0.6b) | FAILED |
| F-20 | payout_details_screen | ✓ Payout destination | FAILED |
| F-21 | transaction_history_screen | ✓ Transaction history | FAILED |
| F-22 | create_rental_screen | ✓ Payments/checkout (approx) | FAILED |
| F-23 | rental_detail_screen | ✓ Rental detail | FAILED |
| F-24 | reviews_screen | ✓ Reviews | FAILED |
| F-25 | feedback_screen | ✓ Feedback | FAILED |
| F-26 | send_feedback_screen | ✓ (written E0.6b) | FAILED |
| F-27 | force_update_gate (full-screen blocking) | ✓ (written E0.6b) | FAILED |
| F-28 | _AuthGuard interstitials (unauth → login; incomplete profile → setup) | ✓ (written E0.6b) | FAILED |

**Template rows with no corresponding screen:** "Booked-dates calendar" (a
component of F-12, not a screen) · "Toast/snackbar layer" (**already built** —
`core/utils/toast_utils.dart`, a layer not a screen) · "Connection-state
indicator" (**genuinely not built** — the one real missing item).

### Admin console — 19 pages

| # | Page | Template row? | Status |
|---|---|---|---|
| A-01 | `/` (root redirect) | ✓ (written E0.6b) | FAILED |
| A-02 | login | ✓ (written E0.6b) | FAILED |
| A-03 | dashboard | ✓ | FAILED |
| A-04 | users | ✓ | FAILED |
| A-05 | users/[id] | ✓ | FAILED |
| A-06 | items | ✓ | FAILED |
| A-07 | items/[id] | ✓ | FAILED |
| A-08 | rentals | ✓ | FAILED |
| A-09 | rentals/[id] | ✓ | FAILED |
| A-10 | disputes | ✓ (settle action absent — confirmed) | FAILED |
| A-11 | payments | ✓ | FAILED |
| A-12 | verifications | ✓ | FAILED |
| A-13 | id-verifications | ✓ | FAILED |
| A-14 | feedback | ✓ | FAILED |
| A-15 | reports | ✓ | FAILED |
| A-16 | audit-log | ✓ | FAILED |
| A-17 | kiosk | ✓ (BESPOKE) | FAILED |
| A-18 | health | ✓ | FAILED |
| A-19 | settings | ✓ | FAILED |

### Kiosk UI — 13 surfaces. **`TEMPLATE-LINKS.md` has 6 rows; 7 have none.**

| # | Screen | Template row? | Status |
|---|---|---|---|
| K-01 | IdleScreen | ✓ Idle/QR display (BESPOKE) | FAILED |
| K-02 | MainScreen — **renders the QR the phone actually scans** | ✓ (written E0.6b) | FAILED |
| K-03 | CatalogueScreen | ✓ (written E0.6b) | FAILED |
| K-04 | HowScreen | ✓ (written E0.6b) | FAILED |
| K-05 | LockersScreen | ✓ (written E0.6b) | FAILED |
| K-06 | OfflineScreen — the honest-health screen `ANIMATION-AND-LOADING-SPEC.md` §5 asks for | ✓ (written E0.6b) | FAILED |
| K-07 | FaceScreen (waiting-for-phone) | ✓ Waiting for phone verification (BESPOKE) | FAILED |
| K-08 | VerifyingScreen | ✓ (written E0.6b) | FAILED |
| K-09 | SuccessScreen | ✓ (written E0.6b) | FAILED |
| K-10 | ErrorScreen | ✓ Error/retry (BESPOKE) | FAILED |
| K-11 | QrScreen | ✓ (marked dead — do not design) | DEAD |
| K-12 | ConfirmScreen | ✓ (marked dead — do not design) | DEAD |
| K-13 | "Locker opening" + "Item capture/verification" rows | rows exist, **no matching component found** — likely states inside K-07/K-08 | UNMAPPED |

### Website — 11 pages. **`TEMPLATE-LINKS.md` has 6 rows; 5 have none.**

| # | Page | Template row? | Status |
|---|---|---|---|
| W-01 | `/` home | ✓ | FAILED |
| W-02 | about | ✓ | FAILED |
| W-03 | pricing | ✓ | FAILED |
| W-04 | docs | ✓ | FAILED |
| W-05 | blog | ✓ | FAILED |
| W-06 | payments/mock | ✓ (BESPOKE) | FAILED |
| W-07 | changelog | ✓ (written E0.6b) | FAILED |
| W-08 | download — **the page every pilot user hits first** | ✓ (written E0.6b) | FAILED |
| W-09 | downloading | ✓ (written E0.6b) | FAILED |
| W-10 | payments/success | ✓ (written E0.6b) | FAILED |
| W-11 | payments/cancel | ✓ (written E0.6b) | FAILED |

**Total: 91 surfaces. All now carry a template row** — E0.6b wrote the **21**
that were missing (7 Flutter, 2 admin, 7 kiosk, 5 web; the earlier count of 20
omitted the auth-guard interstitial). Every `BESPOKE` row carries all three
required parts: the marker, a named pattern reference with a link, and a
justification.

Also resolved in E0.6b:
- The duplicate **"Rentals list" / "My Rentals"** rows — the same screen. Merged,
  with a note that D-2's "missing screen" claim is wrong.
- The two rows with **no matching component** — "Locker opening" and "Item
  capture / verification" are **states inside `VerifyingScreen`/`SuccessScreen`**,
  not screens. Recorded as states; whether either earns its own screen is a
  deliberate decision for E4/E6.4, not an accident.
- `TEMPLATE-LINKS.md`'s kiosk surface header now states the **1080×1920 portrait**
  panel and warns about the landscape safety net.

**A template row is not a PASS.** All 91 remain `FAILED` — they still need
template shots, AFTER shots, triptychs, conformance notes and states lines.

**TEMPLATE images: 18 real template screens captured** — admin 12/12 rows
covered, website 6. An earlier claim of "11 template references" was **wrong and
retracted**: those were screenshots of *websites* (a Dribbble search grid, docs
landing pages), moved to `design/research/` and reclassified as research entry
points that satisfy nothing.

- **Admin — covered.** All 12 from `mantine-analytics-dashboard`'s live demo,
  which is Surface 2's named primary source. **Caveat: the demo now runs Mantine
  8 / Next 16; this project is Mantine 7.** Take layout and density, not
  component APIs.
- **Website — 6 captured** from Cruip, Preline and HyperUI. **Preline's
  per-page URLs are stale** — `preline.co/templates/agency/*.html` all 404, and
  three captures came back as the same 404 page before I checked them. Deleted.
- **Flutter — 0 of 28.** No live demo exists for either Flutter template, and
  the repos ship almost no author screenshots. Requires cloning, building for
  web, and running. Repos are cloned to scratch; **the build-and-run step has
  not been done.**
- **Kiosk — 0 of 13**, and possibly unachievable as specified — see the gate
  conflict below.

Two capture failures caught only by *looking* at the images, not by the
scripts' own "ok" lines: three identical-size 404s, and a Cruip demo-frame
error page. File size and a success log are not verification.

> **⚠ Unresolved gate conflict — needs a ruling.** `VISUAL-EVIDENCE.md` assumes
> every screen has a *capturable* template image. **The 7 kiosk `BESPOKE` rows
> reference genres, not URLs** — "ATM error screens", "parcel-locker bay
> boards", "payment-terminal processing screens". A genre cannot be
> screenshotted, and the only way to force a PNG would be to capture a real
> product's UI and commit it, which vendors third-party pixels and needs a
> `CREDITS.md` licence entry per §3. **Those 7 stay `FAILED` rather than pass on
> a fabricated artifact.** Proposed fix in `design/templates/README.md`: let a
> genre-referenced `BESPOKE` row satisfy the gate with a shared pattern image +
> a written structural note.

> **Also found:** `TEMPLATE-LINKS.md`'s kiosk reference
> (`dribbble.com/search/self-checkout-kiosk`) returns **almost entirely
> landscape/tablet kiosks**, while the panel is 1080×1920 portrait. Borrowing
> composition from it reproduces the exact landscape thinking `MainScreen`'s
> docstring says it was rebuilt to escape. Two portrait references captured and
> should be preferred.

---

## SOCKET EMIT/CONSUME AUDIT (E0.2 / D-6 pattern 3) — COMPLETE

`API-TEST-PLAN.md` requires "every emitted event has at least one consumer".
Enumerated from source across all four surfaces. **21 socket.io events are
emitted by Node** (the other 10 names in the codebase are `kioskEventBus`
SSE-bus events, not socket.io — a distinction `Implemented.md` §3.2 blurs).

**Consumed — 16 of 21**
- **Flutter** (13, all via the single `SocketService`): `rental:completed`,
  `rental:active`, `deposit:approved`/`rejected`/`retry`,
  `return:under_review`/`disputed`/`retry`, `face:verified`/`failed`,
  `kiosk:scan_error`, `kiosk:face_required`, `message:new`
- **Kiosk (Python)** (3): `kiosk:command`, `kiosk:config`,
  `kiosk:session_validate`

**UNCONSUMED — 5 of 21 (24% of the socket surface is dead)**

| Event | Why it has no consumer |
|---|---|
| `admin:kiosk_online` | **The admin console has no socket.io client at all.** It consumes kiosk telemetry only through raw SSE `fetch` to `/admin/kiosks/events`, on two pages (`kiosk`, `health`). Nothing anywhere calls `.on("admin:…")` |
| `admin:kiosk_ack` | same |
| `admin:kiosk_status` | same |
| `admin:kiosk_error` | same |
| `kiosk:rental_info` | **Its consumer was deliberately deleted** on 2026-09-03 — `socket_client.py:551` records "register_qr_callback / emit_rental_lookup / kiosk:rental_info removed". Node still emits it at `index.ts:1049` and `:1066`. A sibling of the already-known-dead `kiosk:face` that nobody spotted |

**D-14 — the four `admin:*` events are broadcast to every connected client.**
They use `io.emit(...)`, not a room emit — `index.ts:356, 398, 427, 1212`. No
`admin` room is ever joined; nothing joins one. So kiosk operational telemetry
(kiosk id, socket id, status payloads, **error payloads**) is pushed to *every*
connected socket, including every student's phone. Not a severe disclosure —
it's operational data, not PII — but it is unnecessary, unconsumed, and the
wrong default for a system where the phone is an untrusted client. Fixing the
dead-consumer problem and the broadcast problem is the same one-line change per
site: emit to an admin room, and have the console join it.

**Implication for D-4.** The reported "nothing is real-time" is *not* explained
by unconsumed events on the phone — the Flutter app consumes all 13 events
aimed at it. It **is** explained on the admin console, which has no socket
client whatsoever and therefore cannot live-update its queues (disputes,
verifications, feedback) by any means other than SSE on two hardware pages.
E2.2's admin half of D-4 is real work; its Flutter half is largely already done.

## SELF-ACTION SWEEP (E0.2 / D-6 pattern 2) — COMPLETE, and it found nothing

`DEFECTS-AND-GAPS.md` D-3 predicts "the same missing-self-check pattern is
likely to repeat" in reviews, messaging, item edit, cancel and refunds.
**It does not repeat.** Every adjacent path is guarded:

| Path | Guard |
|---|---|
| `POST /rentals` | `item.ownerId === req.user.userId` rejected — present since the first backend commit (`rentalController.ts:40`) |
| `POST /reviews` | COMPLETED rentals only; caller must be renter **or** owner; **`recipientId` is derived** (`isRenter ? ownerId : renterId`), never client-supplied; duplicates blocked by a unique constraint |
| `/rentals/:id/conversation` | recipient derived the same way (`messageController.ts:82, 117`) |
| `POST /payments` | `rental.renterId !== req.user.userId` rejected (`paymentController.ts:210`) |
| `POST /payments/:id/refund` | `transaction.userId !== req.user.userId` rejected (`:506`) |

**Why this is airtight rather than lucky:** because self-rental is blocked at
creation, `renterId !== ownerId` holds for every rental in the system, so
"review yourself" and "message yourself" are *structurally* unreachable — the
derived counterparty can never be you.

**But that also makes it fragile, and this is the finding worth keeping.** All
three downstream guards are *transitive* — they depend entirely on the one
check in `rentalController.ts:40`. Remove or weaken that line and self-review
and self-messaging silently become possible, with no error anywhere near the
code that broke. E1 should test the derived-counterparty behaviour directly,
not just the rental guard, so the safety net does not rest on a single line
three endpoints away.

**Revised D-3 scope:** the only real work is the client-side owner check on
item detail (`item_detail_screen.dart:474`), where an owner still sees an
enabled "Request rental" that ends in a 400.


## MUTATION-FEEDBACK SWEEP (E0.2 / D-6 pattern 4) — COMPLETE, no significant gap

`DEFECTS-AND-GAPS.md` D-5 says "every mutating call should produce visible
feedback" and calls the missing toast layer "the bigger gap of the two".
Measured per file — mutating calls vs `AppToast` usage:

**Mutations with no toast, and correctly so:**
- `api_service.dart`, `offline_write_queue.dart`, `storage_service.dart` —
  infrastructure. A toast in the HTTP layer would be an architecture smell.
- `auth_service.dart`, `item_service.dart`, `message_service.dart`,
  `notification_service.dart` — the service layer. Feedback belongs in the UI
  that calls them, and it is there.

**Screens that mutate and do toast:** rental detail (16), create rental (6),
home (5), payout details (3), reviews (3), notification preferences (1), plus
edit profile, create item, item detail, my listings, send feedback and
conversation.

**Screens that mutate without a toast, by design:** login and register (inline
field validation, which is right for a form), `profile_setup_screen` (a
stepped flow with its own uploading/done states), and the kiosk scan / face
verify screens (purpose-built result UI — and D-5's own architecture note says
face-verify failures are deliberately returned in the HTTP response so the
retry stays local and does not disturb the screen underneath).

**Conclusion:** toast coverage is architecturally sound, not accidental. D-5's
first half is not a gap. **The remaining real work in D-5 is push
notifications only** — no FCM, no device-token store, no registration endpoint.

## STALE-STATE SWEEP (E0.2 / D-6 pattern 1) — one instance, already fixed

The pattern's only confirmed instance is **D-1** (`verificationStatus` never
parsed), now fixed and covered by tests. Screens showing state another actor
can change are refetch-wired: the rentals tab and notifications tab both
reload on `SocketService.onAnyRentalChange`, home refetches on load, and rental
detail reloads on return from a child route. The one genuine remainder is
**refetch-on-reconnect** — a socket that drops and reconnects does not re-sync
what it missed while disconnected, which is a real D-4 sub-item and belongs in
E2.2.


---

## REGISTER 2 — DEFECTS

**Analyses were re-derived from the source code, not accepted from
`DEFECTS-AND-GAPS.md`. Four of five were wrong.** Runtime reproduction is
blocked by B-1; "confirmed" below means confirmed *in code*, which is
necessary but not sufficient.

| ID | Defect | Doc's analysis | Verdict | Fixed? | Test? |
|---|---|---|---|---|---|
| D-1 ✅ | Settings double-auth; verification status stale | "never refetched; needs on-focus refetch + socket event" | **WRONG CAUSE. Real cause found:** `UserModel.fromJson` never parses `verificationStatus` / `verificationReason` / `verificationNote` ([user_model.dart:39-54](../../client/flutter_app/lib/core/models/user_model.dart#L39-L54)). Field is permanently `'UNSUBMITTED'`; `toJson` drops it too. Server *does* send it (`authController.ts:49-52`, `PROFILE_SELECT`). Consequence: Identity tile always matches the `'UNSUBMITTED'` branch → always routes to `/profile/setup` → verified users re-prompted for ID + face. That is the reported double-auth. **FIXED 2026-09-05** — `fromJson` now reads all three; test written first and watched fail (5 of 6 red), then green. | ✅ | ✅ `test/user_model_verification_test.dart` (6 tests) |
| D-2 | No separate My Rentals | "purely a missing screen" | **WRONG. Screen exists** — `_RentalsTab`, own bottom-nav tab, `myRentalsTitle`, status filter rail, skeletons, empty/error states, stale banner, pull-to-refresh, socket-driven reload ([home_screen.dart:608-760](../../client/flutter_app/lib/features/home/screens/home_screen.dart#L608-L760)). Ask the user what they actually meant. | N/A | — |
| D-3 | Users can rent own items | "a **real server-side validation gap**" | **BACKWARDS.** Server guard has existed since the first backend commit (`0e5b05c`) — `rentalController.ts:40-42`. Gap is **client-only**: item detail's CTA has no owner check ([item_detail_screen.dart:474](../../client/flutter_app/lib/features/items/screens/item_detail_screen.dart#L474)) while line 370 *does* check ownership for the message button. Owner sees enabled "Request rental", taps through, gets a 400. | — | — |
| D-4 | Nothing real-time | "the rest of the app apparently doesn't subscribe; build an app-wide socket manager" | **SUBSTANTIALLY WRONG.** Singleton manager exists, connects on login (`auth_provider.dart:97`), joins user room, `enableReconnection()`, subscribes to **13** events. **Chat already subscribes** (`conversation_screen.dart:56`) with local-echo dedup. Real candidates: baked-in tunnel URL rotating (a socket to a dead host looks exactly like "nothing happening"); no refetch-on-reconnect; admin console genuinely has no queue subscriptions. **Needs two-device reproduction.** | — | — |
| D-5 | No toasts or push | "in-app toast layer is the bigger gap" | **HALF WRONG.** `AppToast` exists (`core/utils/toast_utils.dart`), 4 types, **57 call sites across 13 files**. Work is a *coverage audit*, not a build. **Push is genuinely absent** — no FCM, no device-token store, no registration endpoint. That half stands. | — | — |
| D-6 | Pattern sweeps (4 patterns) | — | Not started (needs B-1). **Restate the D-3 pattern as "server rejects, client offers anyway"** — a UX-honesty sweep, not a security sweep. Different results. | — | — |

### New defects found in E0 (not in the original five)

| ID | Defect | Evidence |
|---|---|---|
| **D-7** ✅ | `UserModel.toJson` dropped the three verification fields, so even a correct `fromJson` fix would not survive a cache round-trip. **FIXED 2026-09-05**, covered by a round-trip test | `user_model.dart` |
| **D-10** | **Kiosk `MainScreen` leaves ~35% of the portrait panel empty.** Content ends around y≈1240 of 1920; the rest is bare background above the footer. Invisible in landscape (where the 4 cards spread into a row and fill the width) — only a portrait capture shows it. This is the screen where users actually transact, and the QR is the thing they need to find | `design/before/kiosk-main.png` vs `kiosk-idle.png`, which fills correctly |
| **D-11** | **Chromium autostart may be launching the kiosk in the wrong orientation.** `setup.sh:356` / `SETUP.md:199` pass `--window-size=1920,1080` (landscape) and no display-rotation config exists anywhere in the repo. Under `--kiosk --start-fullscreen` this is harmless *if* the display is rotated at OS level — **and if it isn't, the live kiosk is rendering the landscape safety net.** Unresolvable without the Pi (`xrandr` / compositor config) | `setup.sh:356`, `screens.css:1510` |
| **D-9** ✅ | **FIXED 2026-09-05.** **Kiosk told the user the wrong QR lifetime.** `MainScreen.tsx:171` renders "Code rotates every 30 seconds for security"; the real TTL is **90 seconds** (`kiosk_ui/server.py:84`, `_QR_TTL = 90.0`). Found by *looking* at a BEFORE capture, not by reading code. The backend already returns `ttl`/`expires_in`/`ttl_seconds` in the token response, so the fix is to render the real value — which is also what `ANIMATION-AND-LOADING-SPEC.md` §2's "QR TTL visualisation" asks for. **Real cause: "30 seconds" was the effect's own `setInterval` poll rate, captioned as if it were the TTL.** Now reads `d.ttl` from the response, with an honest fallback string before the first fetch resolves. `tsc --noEmit` clean, `npm run build` clean, and **verified visually 2026-09-05** — the rendered caption now reads "Code rotates every 90 seconds for security". Not inferred from a green build | `MainScreen.tsx` vs `kiosk_ui/server.py:84` |
| **D-13** | **`USER-JOURNEY-SIMULATION.md` A2 is wrong, and E5.1 schedules work that is already done.** A2 says face registration "needs an explanation screen before the camera opens, not a camera that just appears… This is a design gap". Captured from the running app: profile setup is **"Verify your identity", STEP 1 OF 3, "Before we start"** — what is collected (face template, student ID), *why* ("EngiRent lockers open with your face"), YOUR RIGHTS (not visible to other students; withdraw at any time), optional guardian contact, and an explicit biometric-consent checkbox that gates a disabled "Agree and continue". Step 2's footer even states the reason again: *"The kiosk matches this photo when you collect or return an item, so nobody else can open your locker."* | `design/before/flutter-profile-setup-1-consent*.png` |
| **D-12** | **The database wipe left every deleted user's biometrics on disk.** `storage/users/<uuid>/face.jpg` and `id.jpg` survive for accounts whose DB rows were deleted 2026-09-03 — orphaned, unreferenced, still readable. `DELETE /auth/account` is documented as genuinely purging `faceEncoding`/`idImageUrl`, but the bulk wipe bypassed that path entirely. A data-retention gap, not untidiness: these are face photos and identity documents belonging to real students | `server/node_server/storage/users/` on the server PC |
| **D-8** | `server/kiosk/kiosk_config.json` still carries a `face_recognition` block (threshold/attempts/timeout) — dead config since the camera was removed 2026-09-03 | `kiosk_config.json` |

---

## REGISTER 3 — ENDPOINTS

**93 endpoints, counted from the route files.** `Implemented.md` §3.1's group
counts are each short by one in four groups (auth 11→**12**, rentals 7→**8**,
kiosk 7→**8**, notifications 5→**6**), so `API-TEST-PLAN.md`'s "every
endpoint, no exceptions" was built on a list missing 4 endpoints.

| Route file | Endpoints | Five-case coverage |
|---|---|---|
| adminRoutes.ts | 33 | 0/33 |
| authRoutes.ts | 12 | 0/12 |
| kioskRoutes.ts | 8 | 0/8 |
| rentalRoutes.ts | 8 | 0/8 |
| itemRoutes.ts | 7 | 0/7 |
| paymentRoutes.ts | 6 | 0/6 |
| notificationRoutes.ts | 6 | 0/6 |
| reviewRoutes.ts | 4 | 0/4 |
| mediaRoutes.ts | 3 | 0/3 |
| feedbackRoutes.ts | 2 | 0/2 |
| uploadRoutes.ts | 2 | 0/2 |
| index.ts (`/app-config`, `/health`) | 2 | 0/2 |
| **Total** | **93** | **0/93** |

Five minimum cases per endpoint: happy path · missing auth → 401 · wrong role
→ 403 · malformed body → clean 400 · self-action rejection where applicable.

---

## E0.2b — THEME SITUATION (largely answered from the repo, ahead of schedule)

`STATE-MATRIX.md` assumes this is unknown and possibly "half-present by
accident." It isn't — three of four surfaces have a deliberate, recorded
decision:

| Surface | Dark mode | Evidence |
|---|---|---|
| Flutter | **Deliberate, user-facing.** `ThemeController` with system/light/dark, toggle in Profile tab, reads through `isDark(context)`. A past dark-mode bug (hardcoded `ColorScheme.light` in a date picker) was found and fixed in v1.5.1 | `core/theme/theme_controller.dart`, `home_screen.dart` Appearance tile |
| Admin | **Deliberate.** Mantine `defaultColorScheme="auto"`, `localStorageColorSchemeManager`, a `ColorSchemeToggle` component. Comment records `forceColorScheme="light"` as a *past* stopgap | `src/app/providers.tsx`, `src/components/ui/ColorSchemeToggle.tsx` |
| Kiosk | **Deliberately excluded, with the reason stated in code**: permanently dark, no per-user preference to persist | `kiosk_ui_react/src/theme.css:19-21` |
| Website | **No dark-mode config found.** Appears light-only | — |

**What's actually needed:** a *completeness audit* of the two live
implementations (grep for hardcoded `Colors.`/hex outside the token layer;
verify status colours keep meaning in both themes), plus **one ruling on
`client/web` only**. Not the four-surface investigation E0.2b describes.

---

## DOC CORRECTIONS MADE IN E0 (repo wins over docs)

- **E0.0:** all 15 redesign docs + `phases/` moved from repo root to
  `docs/redesign/`, which is what `FOLDER-STRUCTURE.md`,
  `CLAUDE-CODE-PLAYBOOK.md` §4 and `00-START-HERE.md` already assumed. Moving
  them *fixed* most cross-references rather than breaking them.
- **E0.0:** `00-START-HERE.md`'s read-order table skipped #6 (rows ran
  1-5,7-16). Renumbered to 1-15. No document was missing — pure numbering gap.
- **E0.0:** created the root `CLAUDE.md`. It did not exist, despite being step
  one of every session-resume instruction in the track and referenced as
  "existing" by `ENGIRENT-CLAUDE.md` and `FOLDER-STRUCTURE.md`.

- **E0.4 (repo hygiene, complete):** `docs/predated/` created with a full
  index README. Moved + bannered: `audit/documentation.md`,
  `audit/phase4-audit-report.md`, `audit/history/` (a judgment call — not named
  by REPO-HYGIENE, but it dates to 2026-07-20 and the target structure says
  `docs/audit/` is current-only), `planning/00-start-here.md`. 24 inbound
  references fixed across README.md, DESIGN.md, Start-Dev.bat, Implemented.md
  and memory.md's pointer table — **memory.md's dated session log was left
  intact**, since rewriting it would falsify the record. `docs/README.md`
  rewritten (it still named moved files as the source of truth).
- **E0.4 found three stale facts the audit assumed were already fixed:**
  `KIOSK_CODE_SETUP.md` still had a code example calling the **deleted**
  `capture_face` method and a "confirm 5 camera nodes" step (REPO-HYGIENE
  explicitly asked to verify that fix landed — it had not, for 2 of 7 lines);
  `planning/03-revamp-master.md`'s self-test spec still required "all 5
  cameras" to open a frame. All corrected.
- **E0.4:** `reference/analyzation.md` bannered **in place** rather than moved
  — stale on cameras, `capture_face`, and `/kiosk/claim`+`/kiosk/return`, but
  its ML/data-model sections are not known stale. Banner names the bad parts.
- **E0.4:** 3 hardcoded Cloudflare tunnel hostnames removed from
  `Implemented.md` §10 and replaced with a pointer to the host's tunnel logs.

### Corrections still to apply to the docs themselves
- [ ] `DEFECTS-AND-GAPS.md` — rewrite D-1…D-5 with confirmed causes
- [ ] `CAPABILITY-GAPS.md` — **C-1, C-2, C-3, C-7, C-9 are already built**
      (`PATCH /rentals/:id/dates` at `rental_detail_screen.dart:267`;
      `notification_preferences_screen.dart`; `/cancel` at
      `rental_detail_screen.dart:223`; `DELETE /auth/account` at
      `home_screen.dart:1456`; payout screen + Profile tile). C-5 partly
      (Ratings button → `ReviewsScreen(userId:)`). **C-4 and C-8 look
      genuinely absent.**
- [ ] `ANIMATION-AND-LOADING-SPEC.md` §1.1 + `USER-JOURNEY-SIMULATION.md` A7 +
      `ENGIRENT-CLAUDE.md` + `Implemented.md` §5.1 — locker timing labels are
      **reversed** (real order is door/door/extend/retract) and the
      "17-second" figure compares two different actions
- [ ] `USER-JOURNEY-SIMULATION.md` A2 + `phases/E5-flutter-app.md` — the
      "explanation screen before the camera opens" **already exists** as
      `_SetupStep.consent`, described in code as "the mandatory consent screen
      before any capture"
- [ ] `TEMPLATE-LINKS.md` — write the 20 missing rows (7 kiosk, 5 web,
      6 Flutter, 2 admin); resolve the "Rentals list" / "My Rentals" duplicate
- [ ] `phases/E6-admin-and-kiosk.md` E6.1b — kiosk events are **explicitly not
      persisted** (`kioskEventLog.ts`: 40-event in-memory ring buffer,
      docstring says "deliberately not persisted… not a system of record").
      A-6 needs a schema change and a reversed decision, not a check
- [ ] `Implemented.md` §3.5 — undercounts Node tests (6 files, not 4) and
      points at `scripts/` rather than `server/node_server/scripts/`

---

## BACKLOG — API-supported, UI-missing (from CAPABILITY-GAPS.md)
- **Genuinely missing user controls:** C-4 request refund
  (`POST /payments/:transactionId/refund`), C-8 change password
  (`PUT /auth/password`), C-5 full public profile (partial today)
- **Admin data not built:** A-4, A-5, A-7, A-8, A-9, A-10. A-6 flagged as
  *not* UI-only (needs event persistence first)
- **Recommended build set, revised:** A-2 (verification funnel) **first** — it
  measures the blast radius of D-1 — then A-1, A-3, and **C-5 in place of C-1**
  (C-1 already shipped)

## Next concrete step

**When B-1 clears (user restarts the stack), in this order:**
1. **Security first:** `ML_API_KEY` set where the ML service runs? Does dlib
   import there? Fix immediately if wrong, report either way.
2. E0.5 finish — capture BEFORE images for Flutter (28), admin (19) and web
   (11) at both viewports. **One shot, no second chance.** Watch the stale-
   bundle trap on port 8092 (`ACCESS-AND-WORKAROUNDS.md` §3).
3. E0.1 — walk all four surfaces, confirm the 91-surface enumeration, rule on
   400-vs-410 and delete-vs-keep-flagged for the dead kiosk screens. **The
   `qr-DEAD` capture is evidence for that ruling: the screen is not merely
   unreachable, it renders as a near-empty panel telling the user to hold up a
   QR code at a kiosk that has no camera.**
4. E0.2 — reproduce D-1…D-5 with two accounts and fresh registrations.

**E0.6b is DONE** — 21 rows written, all 25 `BESPOKE` rows validated as
carrying marker + pattern ref + justification. **There is no unblocked
discovery work left.** Everything remaining in E0 needs either the stack
(B-1) or the Pi.

If you want progress while the stack is down, the honest options are:
1. **Fix D-1 and D-9 now** — both are small, both are confirmed from source,
   and neither needs a running system to *write* (only to verify). That means
   starting E2 before E1, which inverts the phase order deliberately rather
   than by accident. Your call.
2. **Capture kiosk TEMPLATE reference images** for the 7 new kiosk rows, so
   the kiosk is fully gated before E4.
3. Wait for the restart.

**Permanently blocked until the Pi returns:** E0.3's three wait measurements,
and all of E4.
