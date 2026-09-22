# LIFECYCLE-PROCESS-MAP.md — every step of a rental, end to end

**Written 2026-09-23. Derived by reading the code, not the older design docs.**
Where an older doc disagrees with this one, this one is closer to what the
software actually does — but the code itself is the only authority
(`CLAUDE.md`: *the repo wins over the docs*). Every claim below names the file
it came from so the next reader can re-derive it instead of trusting it.

This exists because the process is spread across four surfaces and about a
dozen server modules, and no single document described it end to end. Several
real defects this week (D-93, D-94, D-95) were each "a step that was designed,
built and tested but never wired to a caller" — exactly the kind of gap that
is invisible unless the whole chain is written down in one place.

---

## 0. The cast

| Actor | Surface | What they physically do |
|---|---|---|
| **Renter** | Flutter app | Books, pays, collects from the locker, returns to the locker |
| **Owner** | Flutter app | Lists, deposits the item into the locker, collects it back afterwards |
| **Admin** | Next.js console | Confirms payments, reviews item checks a model was unsure about, settles disputes |
| **Kiosk** | Pi touchscreen + GPIO | Shows a QR code, opens doors, drives the actuator, takes locker photos |
| **ML service** | Python/FastAPI | Face matching, and the item-comparison pipeline |

A **bay** is two compartments, not one: an **upper** compartment behind
`main_door`, a **lower** one behind `bottom_door`, and a linear actuator
between them. `server/node_server/prisma/schema.prisma` models this as
`topStatus`/`topRentalId` and `bottomStatus`/`bottomRentalId`, with the
whole-bay `status` **derived** from both (`deriveLockerStatus`,
`services/pickupLaneService.ts`).

---

## 1. Account setup — before anything else works

`POST /auth/register` → `POST /auth/profile/complete` → `POST /auth/id-photo`
→ `POST /auth/register-face`.

- Registration requires email, password ≥8, studentId, firstName, lastName,
  phone (`routes/authRoutes.ts`). Duplicate email and duplicate student ID now
  produce **different** messages (D-92, `controllers/authController.ts`).
- `register-face` proxies to the ML service **server-side** so the app never
  holds `ML_SERVICE_API_KEY`, and stores a 128-float dlib encoding, AES-256-GCM
  encrypted (`utils/crypto.ts`).
- An admin then approves or rejects the ID (`decideIdVerification`,
  `controllers/adminController.ts`), which sets `isVerified`.

**Gate:** listing an item requires `isVerified`. Face enrolment is what later
unlocks every locker, because every kiosk step verifies a face.

---

## 2. Listing an item

`POST /items`, auth + verified. **Minimum 3 photos**, enforced server-side in
both create (`routes/itemRoutes.ts`) and update
(`controllers/itemController.ts`, `utils/itemPhotoRules.ts`) — the app enforces
the same minimum as a courtesy, but an older build can't be trusted to.

Three separate availability ideas, deliberately not collapsed into one flag
(`schema.prisma`): `isAvailable` (rental state, system-controlled), `isListed`
(the owner's "show this in browse"), `isActive` (soft delete).

---

## 3. Booking and payment → `PENDING` → `AWAITING_DEPOSIT`

1. `POST /rentals` creates the rental as **`PENDING`**, optionally carrying a
   **`pickupDate`** (`controllers/rentalController.ts`) — this one field
   decides the entire deposit lane in §4.
2. `POST /payments` twice: a `RENTAL_PAYMENT` and a `SECURITY_DEPOSIT`.
3. Payment is **manual-confirmation** in the current deployment — the renter
   sends money and taps "I have sent it", which creates a `PENDING`
   transaction; an admin confirms it arrived.
4. **Both** transactions must reach `COMPLETED` before the rental advances
   (`controllers/paymentController.ts:485-510`). Either one alone used to
   trigger it, which let a renter pay only the refundable deposit and still
   have the owner told to hand the item over.
5. On the second confirmation: rental → **`AWAITING_DEPOSIT`**, owner notified.

---

## 4. The kiosk handshake — shared by all three physical steps

Every physical step (deposit, collect, return) uses this identical opening.
**The kiosk shows, the phone scans** — the kiosk's own camera was physically
removed 2026-09-03.

1. Kiosk displays its QR: `KIOSK-001:{token_id}:{timestamp}:{signature}`,
   **90-second TTL**, regenerating.
2. The renter/owner taps the action button in the app, which opens the scan
   screen with a **mode**: `place`, `retrieve`, or `return`
   (`rental_detail_screen.dart` → `_openKioskScan(...)`).
3. Phone emits **`app:kiosk_scan`** `{token, rentalId, mode}`. The server
   **ignores any client-supplied userId** and uses the authenticated socket
   identity (`index.ts:1545-1595`).
4. Server relays **`kiosk:session_validate`** to the kiosk room.
5. **The kiosk validates the token itself** — it accepts only the token
   currently live in its own process, inside the TTL, single use. It is *not* a
   signature recomputation; identity-match is the stricter check, because a
   correctly-signed token that was never issued is still refused
   (`CLAUDE.md`, `server/kiosk/tests/test_qr_token.py`).
6. Kiosk emits **`kiosk:flow_start`** → server opens a **120s** server-side
   session (`openKioskSession`, `services/kioskSessionStore.ts`). From here
   everything trusts that session record and nothing the phone sends.
7. Server decides **who must show their face, from rental status alone** —
   never from client input (`resolveFaceSubject`,
   `services/faceVerificationService.ts:90-112`):
   - `AWAITING_DEPOSIT` → the **owner**
   - everything else → the **renter**
   - **except**: if `releaseRequestedAt != null && retrievedAt == null`, it is
     the **owner** regardless of status (failure mode F5 — an item on its way
     to the lower compartment belongs to the owner again, even on a `DISPUTED`
     rental that still has a renter attached).
8. Phone takes a selfie → `POST /kiosk/verify-face` → Node calls the ML service
   **server-side** → distance threshold 0.5. **4 attempts**, then a forced
   re-scan. Fails **closed** if the ML service is unreachable.
9. On success, `applyFaceVerificationOutcome` runs and branches on rental state.

**The door does not open here.** Since D-78 (2026-09-14) the server creates a
**grant** instead — one rental, one user, one kiosk, one bay, one door, ~6 min
TTL, max 12 opens (`services/kioskBayAccessStore.ts`). The person taps **"Open
Kiosk Now"** (`POST /kiosk/open-bay`, `controllers/kioskController.ts`) when
they are actually standing at the bay with a hand free, and can tap again if it
relocks. Photos are a second tap ("Item is placed").

> ⚠ `USER-JOURNEY-SIMULATION.md` §A6 still ends with "→ locker opens" straight
> after face verification. That has been untrue since D-78.

---

## 5. Owner deposit — and the fork that decides everything after it

Mode `place`, rental `AWAITING_DEPOSIT`, subject = owner.

Face verifies → `assignLocker` picks a bay and reserves the **upper**
compartment as `RESERVED` → owner taps **Open Kiosk Now** → `main_door` opens →
owner puts the item in → owner taps **Item is placed** → kiosk captures 3
frames → `kiosk:images` → ML item comparison.

**The fork is `pickupDate`** (`laneForDeposit`, `services/pickupLaneService.ts`):

| | **Same-day** (no pickupDate, or today) | **Long-lead** (pickupDate is a later day) |
|---|---|---|
| Lane | **fast** (~25s budget, someone is waiting) | **full** — fast check skipped entirely |
| Why | A student is at an open door | Nobody is waiting; buy a verdict that can actually say yes |
| Bay needs | upper compartment only | upper **and lower** free — it's going to be dropped down |
| After approval | item **stays up top** | **dropped to the lower compartment**, upper freed for someone else |

`canAcceptDeposit` enforces the "bay needs" row — assigning a long-lead deposit
to a bay whose lower compartment is occupied would create an item with nowhere
to go.

---

## 6. Item verification — three outcomes, and two tiers

**Thresholds** (`server/python_server/services/ml/app/config.py`):
`≥85 APPROVED` · `60–84 PENDING` · `<60 RETRY`.

**Pipeline:** quality gate → pHash → traditional CV → SIFT+RANSAC → SSIM →
ResNet50 → OCR. Since D-89b the item is **cut from its background** first
(GrabCut + largest connected component + flat-white fill), because the listing
photos and the locker interior are different scenes and several stages were
mostly measuring that difference.

**Two tiers** (`services/mlVerificationService.ts`):
- **fast** — what a student at an open locker waits for. Skips stages worth
  ~40% of the score, so it **structurally cannot reach 85**. It therefore
  cannot approve anything on its own; PENDING is the *normal* outcome.
- **full** — the same pipeline with no time pressure, queued in the background
  for any row already headed to a human (`services/deepReviewQueue.ts`, serial,
  because the ML service is a single Python process).

**`verdictPolicy.ts` caps what a quick check may act on** (D-89):
- `REJECTED` from a fast check is **never** acted on automatically — it becomes
  `PENDING`. It used to cancel a paid rental and move the item on the strength
  of a check that scored a correct glue gun at 53.
- `RETRY` is honoured **once**; the second one becomes `PENDING` rather than
  re-opening the door again.

**Who can open collection:**
- The **full run**, if `canAutoApprove` — completed, not degraded, score ≥85
  (`deepReviewQueue.ts:99-121`).
- An **admin**, in the console (`reviewVerification`).

Until one of those happens, the rental sits `DEPOSITED` with
`verificationStatus` not yet `APPROVED`, and **the server refuses to open the
bay** (D-87d gate, `faceVerificationService.ts`). The app correspondingly hides
the pickup button and shows a waiting note
(`rental_model.dart` → `depositAwaitingConfirmation`).

---

## 7. Renter collects — `DEPOSITED` → `ACTIVE`

Mode `retrieve`, subject = renter. **Requires `verificationStatus === "APPROVED"`.**

1. Face verifies → the claim branch checks **which compartment actually holds
   it** (`doorHoldingRental`, `pickupLaneService.ts:157-164`) — `main_door` if
   `topRentalId` matches, `bottom_door` if `bottomRentalId` does. Reading the
   *columns*, not inferring from the pickup date: the date says what we
   intended, the columns say where the item is.
2. If **neither** compartment claims this rental, it **refuses** rather than
   guessing — a wrong guess opens a door onto someone else's property.
3. A grant is created. **Nothing is committed yet.**
4. Renter taps **Open Kiosk Now** → the door opens → **only now** does the
   claim commit: status → `ACTIVE`, `claimedAt` set, that compartment freed,
   owner notified (`completeClaim`, D-94).

> **D-94, fixed 2026-09-22.** All of step 4's writes used to happen back in
> step 3, at approval time. A renter who cancelled after approving but before
> opening left the database certain the item had been collected while it was
> still in the compartment — and the retry was then read as a *return* (because
> status was already `ACTIVE`), which opened a different, empty door.

---

## 8. Renter returns — `ACTIVE` → `VERIFICATION`

Mode `return`, subject = renter. `assignLocker` picks a bay (possibly a
different one), same grant-then-tap choreography, item goes into the **upper**
compartment, kiosk captures, ML runs, `returnVerdict` applies the same retry
cap.

Outcomes (`index.ts`, the `kiosk:images` return branch):
- **APPROVED** → `completeRental()` → §9 and §10.
- **PENDING** → rental `VERIFICATION`, owner notified "under review", renter's
  phone gets `return:under_review`. Waits for the full run or a human.
- **REJECTED** → rental **`DISPUTED`**, owner notified, renter emailed, and the
  item is **released back to the owner immediately** (R5) — the disputed object
  should not stay sealed in a bay while people argue about it.

---

## 9. Release and retrieval — how the owner gets their item back

This is E4.6, and it is the part that was fully built and **never called** for
a successful return until D-95 (2026-09-22).

**`requestRelease`** (`services/retrievalService.ts`) is the executor;
**`retrievalPolicy.ts`** is the pure, unit-tested decision module. Reasons:

| | Trigger | Called from |
|---|---|---|
| **R1** `LATE_COLLECTION` | Renter never collected a deposit | hourly cron (`5 * * * *`) |
| **R2** `OWNER_RETURN_PICKUP` | **A return passed** | the four completion paths (D-95) |
| **R3** `CANCELLED_WITH_ITEM` | Cancelled with the item inside | cancel paths |
| **R4** `DEPOSIT_REJECTED` | A deposit was rejected | `index.ts`, `adminController.ts` |
| **R5** `RETURN_DISPUTED` | A return was rejected | `index.ts`, `reviewVerification` |

**What a release actually does**, and it is not always a stroke:
- Item up top **and** lower compartment genuinely free → **actuator stroke**,
  upper to lower. Per D-93 that sequence is **retract first (opens the trap
  door, the item drops), then extend (closes it)**.
- Item already in the lower compartment, **or** the lower one holds someone
  else's stored item → **released in place, no stroke**. Stroking in the second
  case would stack two students' property in one compartment — the single
  invariant this design exists to protect.
- Neither compartment records the rental → **refuses**, no command sent.

Then: `releaseRequestedAt` is written **before** the command goes out;
`releasedAt` only on the Pi's acknowledgement. A crash between the two leaves
"asked, never confirmed", which is recoverable; the reverse would claim an item
had moved when it hadn't (failure mode F3).

The owner is notified **"Item ready to collect … scan the kiosk QR"**, gets
`rental:released`, and collects via the handshake in §4 — which now resolves the
face subject to **them**, because `releaseRequestedAt` is set (§4 step 7). The
retrieve branch opens whichever door holds it and sets `retrievedAt`.

> **Ordering is load-bearing.** `requestRelease` must run **before** status
> flips to `COMPLETED`. `holdingLocker()` keys off `VERIFICATION`/`DISPUTED` to
> know it's the *return* bay, and `reasonForStatus("COMPLETED")` returns `null`
> — no release path at all. Get the order wrong and it silently refuses.

---

## 10. Settlement — the money

`finalizeRentalCompletion` (`services/rentalSettlementService.ts`), two
independent movements over two different PayMongo mechanisms:

1. **Deposit refund** — v1 `/refunds` reversing the original
   `SECURITY_DEPOSIT` payment, **minus** any `DAMAGE_FEE`/`LATE_FEE`/
   `EXTENSION_FEE` already logged. That is what "fees draw from the deposit"
   means mechanically: a smaller refund *is* the deduction. Floors at 0; a
   shortfall beyond the deposit is **not** auto-collected, it notifies an admin.
2. **Owner payout** — a *new* v2 Disbursement Transfer to the owner's
   configured destination. A different recipient than whoever paid, so it can't
   reuse the refund mechanism. If the owner has no payout destination set, the
   earning is logged `PENDING` and they're told to add one — completion is
   never blocked on it.

Either half failing must not block the other.

**Four code paths reach `COMPLETED`**, and each must do both §9 and §10:

| Path | File |
|---|---|
| `completeRental()` — automatic, ML approved the return | `index.ts` |
| `reviewVerification()` approve — **admin manual review** | `adminController.ts` |
| `settleDispute()` — dispute settled | `adminController.ts` |
| `forceCompleteRental()` — admin escape hatch | `adminController.ts` |

> **D-95, fixed 2026-09-22.** Only `settleDispute` and (for money only)
> `completeRental` were complete. Manual review — *the normal path*, since the
> fast tier can't approve — refunded nothing and released nothing. Confirmed on
> real data: rental `331ce382` completed with a real ₱500 deposit and ₱90
> payment on record and **zero** refund/payout rows, while its own
> notifications promised both.

---

## 11. The autonomous jobs

| Cron | Schedule | What it does |
|---|---|---|
| E4.6 collection sweep | `5 * * * *` | `DEPOSITED` + never collected → release to owner (R1), then cancel + void (D-91) |
| Overdue undeposited | `10 * * * *` | `PENDING`/`AWAITING_DEPOSIT` >24h past end date → cancel, void, notify both (D-91) |
| Late fees | `0 1 * * *` | `ACTIVE` past end date → `LATE_FEE` transaction against the held deposit |

The release policy gates every one of these: release window (default 07:00–
21:00), `auto_release_enabled`, bay operational, bay not busy, lower compartment
not already holding an un-collected item. An **owner standing at the kiosk
asking for their own item** (`onDemand`) bypasses the window and the auto-release
switch — but never the safety checks.

---

## 12. Status reference

| Rental status | Means | Item is |
|---|---|---|
| `PENDING` | Booked, not fully paid | with the owner |
| `AWAITING_DEPOSIT` | Paid, owner must deposit | with the owner |
| `DEPOSITED` | In the locker; collectable **only** once `verificationStatus = APPROVED` | upper, or lower if long-lead |
| `ACTIVE` | Collected | with the renter |
| `VERIFICATION` | Returned, being checked | upper compartment of the return bay |
| `COMPLETED` | Done | released to the owner |
| `DISPUTED` | A return was rejected | released to the owner pending settlement |
| `CANCELLED` | Cancelled/auto-cancelled | released if it was ever inside |

---

## 13. Open, as of 2026-09-23

- **D-93 unproven on hardware.** The retract/extend fix is deployed to the Pi
  and the controller restarted cleanly, but the corrected sequence has not
  fired once on a real drop. Only a genuine long-lead drop, or an explicitly
  confirmed manual test, proves it.
- **The kiosk controller is running unsupervised.** Launched manually because
  `Restart=on-failure` doesn't cover a plain SIGTERM and there is no
  passwordless sudo. `systemctl status` will wrongly report it dead, and a
  crash will not auto-restart it. Needs someone with the Pi's sudo password.
- **D-95 unproven on a real return.** Deployed and unit-tested; no rental has
  gone through a full return since.
- **No per-locker concurrency lock.** Nothing stops two commands running
  against the same bay at once. Requested, not yet scoped.
- **The E4.6 retrieve branch** commits `retrievedAt` in the same block that
  emits the door command, with no confirmation between — a smaller version of
  D-94's shape.
- **`USER-JOURNEY-SIMULATION.md` §A6** is stale (see §4).
- **Dispute settlement has no live socket push.** Consistent with the rest of
  the codebase (notification rows are pull-based; only specific in-flow events
  are pushed), so not treated as a regression — but worth a deliberate ruling.

---

## 14. Starting prompt for the clean-up session

Paste this after `/clear`:

```
Read, in this order: CLAUDE.md, memory.md, docs/PROGRESS.md (status line +
the newest dated entries), then docs/redesign/LIFECYCLE-PROCESS-MAP.md in
full. That last one is the end-to-end process map — use it as the spine.

This session has ONE job: close the open items in §13 of the process map.
No new features. No redesign.

Work in this order, and stop after each to report:

1. Get the kiosk controller back under systemd. It is running as a bare
   nohup process right now; systemctl will wrongly say it's dead and a crash
   won't restart it. This needs the Pi's sudo password from the human — ask
   for it, don't work around it. Reach the Pi via the jump host (see
   memory.md's kiosk entry; its LAN IP moves, match on MAC prefix 2C-CF-67).

2. Prove D-93 on real hardware. The retract-then-extend fix is deployed but
   has never fired. Do NOT trigger an actuator without telling the human
   exactly what will move, which bay, and for how long, then waiting for an
   explicit yes (G11).

3. Prove D-95 on a real return: one rental all the way through deposit →
   collect → return → completion, checking that the item is released to the
   owner AND that DEPOSIT_REFUND + OWNER_PAYOUT rows actually appear.

4. Then, and only then, scope the per-locker concurrency lock.

Rules that bind here: the repo wins over the docs; a green test is not a
fix — verify on screen; never drive hardware without explicit confirmation
first; security findings get fixed immediately, not filed. Record what you
find in docs/PROGRESS.md as you go rather than saving it for the end.

Current live state to re-derive, not assume: run the DB check for rentals,
lockers and settlement transactions before touching anything.
```
