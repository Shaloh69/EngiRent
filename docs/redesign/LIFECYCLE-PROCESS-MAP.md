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

> **Where things are.** **Item:** still with the owner, nowhere near a locker.
> **Money:** both payments sit `COMPLETED` against the rental — the platform
> holds them. The deposit is the renter's liability cap from here on; the
> rental payment is owed to the owner but not yet sent.

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

> **Where things are.** **Item:** moves from the owner's hands into the bay's
> **upper compartment**, the moment the owner closes the door. From here until
> collection it is in the machine and nobody's hands. The database says so via
> `topStatus = OCCUPIED` + `topRentalId`, written through the single
> compartment writer (`services/lockerCompartments.ts`) — never directly.
> **Money:** unchanged, both payments still held.

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

> **Where things are.** **Item:** in the upper compartment throughout — a
> verification verdict never moves anything by itself. The one exception is a
> **long-lead** deposit that gets approved: that triggers `dropToStorage`,
> which strokes the actuator and moves it to the **lower** compartment,
> freeing the upper bay for someone else (E5.4). **Money:** unchanged. Note
> what this means if the check drags — the renter has paid in full for an item
> they cannot yet touch, which is why "PENDING is not a failure" matters as a
> UI rule and not just a label.

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

> **Where things are.** **Item:** leaves the machine and is now **with the
> renter**. The compartment it came out of is freed — and *only* that one; the
> sibling compartment may hold a different student's property and must keep
> saying so. **Money:** unchanged, still both held. The owner is not paid at
> collection — they are paid at completion, which is what gives the deposit
> something to be held against for the whole rental.

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

> **Where things are.** **Item:** back in the machine, **upper compartment of
> the return bay** — which need not be the bay it was deposited in.
> `holdingLocker()` knows this: for `VERIFICATION`/`DISPUTED` it reads
> `returnLocker`, for anything else `depositLocker`. **Money:** unchanged, both
> still held. Any `LATE_FEE` the daily cron has accrued is already sitting as
> `COMPLETED` transactions waiting to be netted off at settlement.

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

> **Where things are.** **Item:** either strokes down to the **lower**
> compartment or stays where it is and is re-labelled `AWAITING_RETRIEVAL` —
> and that label is the most important one in the system. It does **not** mean
> available. It means *an item is in here and its owner has not taken it yet*,
> and it is what stops a second item being dropped on top of someone's
> property. While an actuator is mid-travel **both** compartments are blocked,
> because the item is cleanly in neither; `confirmRelease` settles them only on
> the Pi's acknowledgement. **Money:** unchanged — release is a physical act,
> not a financial one. The two are settled separately and in that order.

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

> **Where things are.** **Item:** out of the machine and back with its owner
> (that is §9's job, and it must already have happened — this is why §9 runs
> *before* the status flip, not after). **Money:** this is the only step where
> it moves. Deposit minus deductions goes back to the renter; the rental
> payment goes to the owner; both are recorded as new `Transaction` rows
> (`DEPOSIT_REFUND`, `OWNER_PAYOUT`) so the ledger shows what happened rather
> than just ending. **If you are ever checking whether a rental really
> finished, check for those two rows — not the `COMPLETED` status.** That is
> exactly the distinction that hid D-95: the status said done, the ledger said
> nothing had moved, and the notifications sided with the status.

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

## 12. THE EXCLUSIVITY RULE — one bay, one process, start to finish

**The rule, stated plainly:**

> Once a bay begins a process, that bay is **occupied by that process until it
> finishes**. No second process may start on it, and nothing may overwrite it.
> A bay is busy from the moment work is committed to it until the moment that
> work is finished or has demonstrably failed — not merely while a motor is
> turning.

A "process" here is any of: a door-open window, a photo capture, an actuator
stroke, a deposit/collect/return/retrieve flow in progress, or a self-test.

**Why it is not optional.** The hardware is four bays of solenoids and linear
actuators in an unattended public corridor. A `drop_item` on bay 1 is a
**44-second** sequence (22s retract + 22s extend on bay 1's calibration). If an
`open_door` for bay 1 lands 2 seconds into that, today both run — a door
unlocking onto a compartment whose floor is mid-travel, with a person reaching
in because their phone just told them to.

### What actually exists today — and the part that doesn't

**Kiosk side: nothing.** `on_command` dispatches every command with
`asyncio.create_task(_run_with_ack(...))` — fire-and-forget, no queue, no lock,
no per-bay state (`server/kiosk/services/socket_client.py:431-457`). Two
commands for the same bay run concurrently. `ActuatorController.place_item`
sleeps between its phases with nothing stopping another task flipping the same
relays during the sleep. The only `asyncio.Lock` in the file guards the
*offline outbound event queue*, which is unrelated.

**Server side: one guard, designed correctly, and completely dead.**
`retrievalPolicy.ts:209-216` has exactly the right rule — **F2**, refuse to
move a bay someone may have a hand inside, with a comment stating it is *"not
negotiable by `onDemand`: an owner requesting their item does not make someone
else's hand safe."* It reads two inputs. **Neither is ever supplied:**

| Input | How it should be fed | Reality |
|---|---|---|
| `hasOpenDoor` | `isDoorOpen()` reads a `Set` filled by `noteDoorOpen`/`noteDoorClosed` | **Both exported, neither is called anywhere.** The Set is always empty |
| `hasLiveKioskSession` | passed by the caller | **No caller passes it.** `opts.hasLiveKioskSession ?? false` — always `false` |

So `decideRelease` can never return `bay_busy` in production. Its three tests
pass because they hand the flags in directly
(`__tests__/retrievalPolicy.test.ts:75-99`) — a pure function proven correct and
wired to nothing. **This is `CLAUDE.md`'s "a green test is not a fix", exactly.**

And `openBay` (`controllers/kioskController.ts`) checks the *grant* — right
user, not expired, under the open cap — but never asks whether the bay is busy.
Bay-access grants are keyed by **`rentalId`**, not by bay, so two rentals can
legitimately hold live grants on the same bay at once.

**Net: there is no layer anywhere that prevents concurrent actuation on one
bay.** Recorded as **D-96**.

### What the rule must cover when it is built

1. **A per-bay lock on the kiosk**, held for the *whole* handler, not just the
   GPIO call. This is the real guard — the Pi is the only place that knows when
   a stroke is genuinely finished. A command arriving for a busy bay is
   **refused and acknowledged as refused**, never silently queued: a door that
   opens 40 seconds late is worse than one that refused.
2. **Feed F2's two inputs**, so the server stops proposing work it should know
   better than to propose. `noteDoorOpen`/`noteDoorClosed` called on the real
   door lifecycle, and `hasLiveKioskSession` passed from the session store.
3. **A bay-busy check in `openBay`**, so the server refuses before commanding
   rather than relying on the Pi to catch it.
4. **The person is told.** "Locker 1 is finishing something — please wait" on
   both the kiosk screen and the phone. A refusal the user cannot see reads as
   a broken machine.
5. **Failure has a deadline.** A lock with no timeout is a bay bricked until
   someone restarts the Pi. Failure mode F3 (a drop commanded, never
   acknowledged) already exists for exactly this and must release the lock,
   loudly, into a state a human can reconcile.

**Defence in depth, deliberately.** The kiosk lock is the one that must be
right; the server-side checks exist so the two disagree loudly instead of the
Pi silently absorbing commands that should never have been sent.

---

## 13. WHAT THE PERSON SEES — feedback at every step

**The rule:** every step tells the person, in one short line, **what just
happened, what is happening now, and what to do next**. A step that changes
state silently is unfinished work, even when the state change is correct.

Three of this week's defects were only *visible* as "the app didn't tell me" —
D-90b stranded a renter on "Checking" forever, D-94 sent someone to the wrong
door, and the stuck collection that started this map looked to the user like a
dead end. In every case the server was right and the person was uninformed.

### What already exists — use it, don't rebuild it

- **`AppToast`** (`core/utils/toast_utils.dart`), 68 call sites across 15
  files, five variants: `success` · `error` · `info` · `warning` · **`review`**.
  `review` exists specifically because **PENDING is cyan-teal and must never
  borrow warning-yellow** (E3.1's ruling). Use it for anything "a human will
  look at this".
- **14 `NotificationType` values**, every one mapped to an icon in
  `account_activity_screen.dart`. No gaps — a new type needs a mapping there.
- **Per-flow socket events**, listed below. There is deliberately **no generic
  "new notification" push**: the notification list is pull-based, and live
  delivery is built only for specific in-flow moments. Keep that split.
- **Kiosk screens**: `idle · main · how · catalogue · lockers · face ·
  verifying · working · success · error` (`kiosk_ui_react/src/types.ts`).
  `working` exists because E3.2 found a 15s door and a 34–46s actuator
  sequence running **with the main menu on screen**.

### The gaps, found 2026-09-23

- **D-97 — `rental:released` is emitted and nobody listens.** The server sends
  it to the owner from both release paths (`retrievalService.ts:239,300`); it
  appears **nowhere** in the Flutter app. That is the *"your item is ready to
  collect"* moment on the retrieval path — the owner finds out only when they
  next open the app and pull the notification list. **Fifth instance of the
  designed-tested-never-connected pattern**, after D-90b, D-94, D-95, D-96.
- **`kiosk_scan_screen.dart` has zero `AppToast` calls.** The one screen people
  use while standing at a locker has none of the feedback infrastructure every
  other screen has. Its state is driven entirely by phase changes.

### Per-step: what the phone says, what the kiosk shows

| Step | Phone | Kiosk | Today |
|---|---|---|---|
| Both payments clear → `AWAITING_DEPOSIT` | success toast to owner: "Paid — drop the item off" | — | notification only |
| Owner scans QR | "Connected — look up at the kiosk" | leaves `idle`/`main` | ✓ `kiosk:face_required` |
| Face check running | progress, attempt *n* of 4, **120s session visible as a calm countdown** | `face` → `verifying` | partial — no countdown |
| Face fails | `error` toast naming the reason, non-blaming | `error`, auto-returns | ✓ `face:failed` |
| Grant issued | **"Open Kiosk Now" must be unmissable** — it is the only way forward | waiting | ✓ |
| Door opens | "Bay 1 open — 15s" driven by **the kiosk's real per-bay timing**, not a fixed guess | `working` | partial, D-82 open |
| Item placed | "Photographing…" then the verdict | `working` → `verifying` | ✓ |
| **APPROVED** | `success` | `success` | ✓ |
| **PENDING** | **`review` toast**, never warning — "a person is checking, usually minutes" | `success` (item *is* in) | ✓ `return:under_review` |
| **RETRY** | what would make the next attempt better, and which attempt they're on | `error` → retry | ✓ `deposit:retry` |
| Deposit approved by admin/full model | renter: "Ready to collect" | — | ✓ `deposit:approved`/`confirmed` |
| Collection committed | owner: "Collected" · renter: `success` | `success` | ✓ `rental:active` |
| Return under review | renter: `review` toast | `success` | ✓ (D-90b) |
| Return disputed | both told, plainly, no blame | `error` | ✓ `return:disputed` |
| **Item released to owner** | **"Ready to collect at bay N — scan the kiosk QR"** | — | **✗ D-97 — emitted, no listener** |
| Owner retrieves | `success` | `success` | ✓ |
| Settled | renter: refund amount **and any deduction, itemised** · owner: payout sent | — | notification only |
| Bay busy (§12) | "Locker N is finishing something — please wait" | same, on the bay | **✗ doesn't exist yet** |

### Rules for anything written here

1. **Concise.** One line. "Bay 1 open — 15 seconds" beats a paragraph. Someone
   is holding an instrument in a corridor.
2. **PENDING is never a failure colour.** `review`, not `warning`. This has a
   ruling behind it (E3.1) and has been got wrong before.
3. **The two screens must never disagree.** For a few seconds the person is
   looking at their phone *and* the kiosk. If they say different things, the
   person cannot tell which to believe.
4. **Long waits show progress, not a spinner.** Up to 22s of actuator and a
   multi-stage ML pipeline. 22 seconds of indeterminate spinner reads as a
   crash.
5. **Drive from real state, never a fixed timer.** Per-bay timings genuinely
   differ (bay 2 is 5s where bay 1 is 15s). A hardcoded duration desyncs on
   most bays.
6. **Money is always itemised.** "₱450 refunded (₱50 late fee withheld)", never
   a bare number — this is the most trust-sensitive message in the product.

---

## 14. Status reference

| Rental status | Means | **Where the item is** | **Where the money is** |
|---|---|---|---|
| `PENDING` | Booked, not fully paid | with the owner | one or neither payment in; nothing owed yet |
| `AWAITING_DEPOSIT` | Both payments cleared, owner must deposit | with the owner | both held by the platform |
| `DEPOSITED` | In the locker; collectable **only** once `verificationStatus = APPROVED` | upper compartment — or lower, if a long-lead deposit was dropped | both held |
| `ACTIVE` | Collected | with the renter | both held; late fees may accrue against the deposit |
| `VERIFICATION` | Returned, being checked | upper compartment of the **return** bay | both held; fees accrued but not yet netted |
| `COMPLETED` | Done | released to the owner | **moved** — `DEPOSIT_REFUND` + `OWNER_PAYOUT` rows must exist |
| `DISPUTED` | A return was rejected | released to the owner pending settlement | both held until settled |
| `CANCELLED` | Cancelled/auto-cancelled | released if it was ever inside | voided (`REFUNDED`), no PayMongo call |

**Reading this table as a check:** any row where the item column and the
physical bay disagree is a bug, and any `COMPLETED` rental without both ledger
rows is a bug. Those two sentences would have caught D-94 and D-95 on the day
they shipped.

---

## 15. Open, as of 2026-09-23

- **D-97 — `rental:released` is emitted and nothing listens.** The owner's
  *"your item is ready to collect"* moment, sent from both release paths
  (`retrievalService.ts:239,300`), appears nowhere in the Flutter app. They
  find out only on the next pull of the notification list. Fifth instance of
  the designed-tested-never-connected pattern. See §13.
- **Feedback is thin at the moments it matters most.**
  `kiosk_scan_screen.dart` — the screen someone uses while standing at a
  locker — has **zero** `AppToast` calls, while 15 other files have 68 between
  them. The 120s session countdown and per-attempt state are not shown. See
  §13's table for what each step should say.
- **D-96 — nothing enforces the exclusivity rule (§12), on either side.** The
  kiosk dispatches every command fire-and-forget with no per-bay lock, and the
  server's own F2 "a hand may be inside" guard is dead because neither of its
  two inputs is ever fed. Three passing tests prove a pure function that is
  wired to nothing. This is the highest-severity item here: it is the one that
  can move a motor while someone is reaching into the bay.
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
- **The E4.6 retrieve branch** commits `retrievedAt` in the same block that
  emits the door command, with no confirmation between — a smaller version of
  D-94's shape.
- **`USER-JOURNEY-SIMULATION.md` §A6** is stale (see §4).
- **Dispute settlement has no live socket push.** Consistent with the rest of
  the codebase (notification rows are pull-based; only specific in-flow events
  are pushed), so not treated as a regression — but worth a deliberate ruling.

---

## 16. Starting prompt for the clean-up session

Paste this after `/clear`:

```
Read, in this order: CLAUDE.md, memory.md, docs/PROGRESS.md (status line +
the newest dated entries), then docs/redesign/LIFECYCLE-PROCESS-MAP.md in
FULL. That map is the spine of this session — §12 is the one-process-per-bay
rule, §13 is what the person should see at every step, §15 is what's open.

This session has ONE job: close §15. Nothing else. No new features, no
redesign, no refactors of code that isn't in the way. If you find something
outside that list, write it into docs/PROGRESS.md and keep going.

Work in this order and STOP after each one to report before moving on:

1. KIOSK BACK UNDER SYSTEMD.
   It is running as a bare nohup process; `systemctl status` wrongly reports
   it dead and a crash will not restart it. Needs the Pi's sudo password —
   ASK the human for it, do not work around it. Working around it is how it
   ended up unsupervised. Reach the Pi through the jump host (memory.md's
   kiosk entry; its LAN IP moves — match on MAC prefix 2C-CF-67, not a
   remembered address).

2. D-96 — THE EXCLUSIVITY RULE (§12). Safety-critical; do this before any
   hardware test.
   - A per-bay lock ON THE KIOSK, held for the whole handler. The Pi is the
     only place that knows when a stroke has genuinely finished.
   - A command for a busy bay is REFUSED and acked as refused — never
     silently queued. A door that opens 40s late is worse than one that
     refused.
   - A timeout, so a failed command cannot brick a bay until someone
     restarts the Pi. F3 (commanded, never acknowledged) already exists for
     this and must release the lock loudly.
   - Then feed F2's two dead inputs server-side: noteDoorOpen/noteDoorClosed
     are exported and never called anywhere; nothing ever passes
     hasLiveKioskSession. Add a bay-busy check to openBay.
   - Test that a second command for a busy bay is refused. Note that F2's
     three existing tests PASS TODAY against a guard that cannot fire — a
     green test is not evidence here.

3. D-97 + THE FEEDBACK PASS (§13).
   - rental:released is emitted from retrievalService.ts:239,300 and NOTHING
     in the Flutter app listens. That is the owner's "your item is ready to
     collect". Wire it, and show it.
   - Then walk §13's table and close the gaps. Use the existing AppToast
     (success/error/info/warning/review) — do not build a new system. PENDING
     uses `review`, never `warning`; that has a ruling behind it and has been
     got wrong before.
   - kiosk_scan_screen.dart has ZERO AppToast calls today. It is the screen
     people use while standing at a locker. Fix that first within this step.
   - Keep every message to one line: what just happened, what's happening,
     what to do next. Drive from real socket/hardware state, never a fixed
     timer — per-bay timings genuinely differ (bay 2 is 5s where bay 1 is
     15s).

4. PROVE D-93 ON REAL HARDWARE.
   The retract-then-extend fix is deployed to the Pi and has never fired.
   Do NOT trigger an actuator without first telling the human exactly what
   will move, which bay, and for how long — then waiting for an explicit yes
   (G11). An approval earlier in the session does not carry to a later one.

5. PROVE D-95 ON A REAL RETURN.
   One rental the whole way: deposit → collect → return → completion. Check
   the item is actually released to the owner AND that DEPOSIT_REFUND and
   OWNER_PAYOUT rows appear. Per §14: a COMPLETED status without those two
   rows is the bug, not the proof.

Rules that bind here:
- The repo wins over the docs. Where this map and the code disagree, the
  code is right — fix the map and say so.
- A green test is not a fix. Open the thing and look at it. This codebase
  has now shipped FIVE defects (D-90b, D-94, D-95, D-96, D-97) that were
  designed, unit-tested and never connected to a caller. Unit tests of pure
  modules prove logic and say nothing about whether anything calls it.
- Never drive a door, actuator or self_test without saying what will move,
  which bay, how long, and getting an explicit yes first.
- Record findings in docs/PROGRESS.md as you go, not at the end.

Re-derive, do not assume: before touching anything, query the live database
for rentals, locker compartment state and settlement transactions, and
confirm which process is really the EngiRent API (fingerprint it by its
loaded Prisma module path — this box also runs another thesis project whose
API is an identical `node dist/index.js`).
```
