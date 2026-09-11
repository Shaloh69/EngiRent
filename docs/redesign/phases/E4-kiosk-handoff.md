# E4 — The Two-Screen Handoff

**Goal:** the signature moment, designed as one interface across two displays.
Scheduled before the ordinary screens deliberately — hardest, most valuable,
and it teaches you the most about the rest.

## E4.1 — Choreograph both screens together
Build against `ANIMATION-AND-LOADING-SPEC.md` §2's table. Kiosk screen and
phone screen for each beat designed **in the same sitting**, never separately.
- [ ] Idle / QR display ↔ scan viewfinder
- [ ] Scan detected — **kiosk must react visibly and immediately**
- [ ] Verification needed — kiosk points to phone, names **who** it waits for
      (owner for deposit, renter otherwise — `resolveFaceSubject`'s real rule)
- [ ] Verifying — phone shows progress + **visible 120s countdown** +
      **attempt N of 4**; kiosk shows an alive waiting state
- [ ] Success — kiosk leads, hands attention back to the physical locker
- [ ] Opening — determinate progress from **real per-locker duration** (E0.3's
      measured numbers)
- [ ] Failure — recoverable in place, both screens

## E4.2 — QR freshness
- [ ] 90s TTL visualised, legible across a corridor, informative not urgent

## E4.3 — Face verify screen (phone)
- [ ] Live framing feedback (too dark / hold still) **before** upload
- [ ] In-place retry — failures return in the HTTP response specifically so
      the screen underneath isn't disturbed. Use that
- [ ] Fail-closed message that reads as the system's fault, not the user's face

## E4.4 — Verify against real hardware
- [ ] Real socket events, not mocks
- [ ] **At least two lockers with different calibrated timings** — a sync bug
      only shows up across two different durations
- [ ] Capture both screens at every beat

## E4.5 — The media pipeline, end to end, and fewer human approvals

**Added 2026-09-11 on the user's instruction.** Two asks: *prove the whole
media path for object-reference detection actually works*, and *stop sending
so much to a human — auto-approve above a confidence bar*.

> **SEQUENCING, and it is not negotiable by this phase.** `ENGIRENT-CLAUDE.md`
> §1 puts the item-comparison pipeline **in scope** but makes **`CAPABILITY-GAPS.md`
> A-3 a prerequisite, not a companion**, and says the 85/60 thresholds *stay
> put* unless A-3's measured distribution says otherwise: *"nobody can say
> which of the documented failure modes is real and which is theoretical...
> Measure, then change."*
>
> So **"auto-approve at 90%" is not a number this phase may pick.** 90 is a
> guess until the distribution is measured, and a guessed auto-approve bar
> converts a human review into a wrong outcome silently. A-3 first.

### E4.5a — Prove the media path works end to end (no threshold change)
This is pure verification and can start immediately.
- [ ] Trace ONE real deposit through every hop and show the artifact at each:
      Pi camera → `kiosk:images` → stored file → signed URL → ML fetch →
      `runMlVerification` → verdict → rental transition. **A hop that returns
      200 is not a hop that did something** — D-39 was exactly that
- [ ] Prove the ML service **actually fetched and decoded** the frames, rather
      than scoring a fetch failure as a low score. Fail-closed must be
      distinguishable from fail-quietly in the logs
      — **HALF ANSWERED, and the other half is D-65.** `mlVerificationService`
      *does* distinguish them, returning `unavailable: true` +
      `unavailableReason`, with a unit test for it. **But the flag is read
      nowhere and persisted nowhere**, so in the database a fetch failure is
      byte-identical to a genuine zero-confidence comparison — which is exactly
      why A-3's two rows cannot be interpreted. Needs a schema change; blocks
      E4.5c.
      — **OPEN. The persistence half is BUILT 2026-09-11 and NOT YET LIVE.**
      `Verification` gains `unavailable Boolean @default(false)` +
      `unavailableReason String?` (`prisma/schema.prisma`); all **four**
      `prisma.verification.create` sites in `src/index.ts` spread
      `verificationEvidenceFields(mlResult)`; both ML-unreachable catch blocks
      now build `mlUnreachableResult()` (`unavailableReason: "ml_unreachable"`
      — the third case the service cannot tag itself, because it never ran).
      12 tests in `src/services/__tests__/verificationEvidence.test.ts`,
      **mutation-checked**: dropping the spread from 1 of the 4 write sites
      turns it red (verified, 1 failed / 11 passed). `tsc` clean, 142/142 Jest.
      **DEPLOYED 2026-09-11** to the live database and API (user-authorised):
      `db push` reported in sync, `SHOW COLUMNS` confirms
      `unavailable tinyint(1) NOT NULL DEFAULT 0` + `unavailableReason
      varchar(191) NULL`, `dist/index.js` carries 4 spreads, the API restarted
      (**PID 22976 → 17884**) and serves real JSON, and the two pre-D-65 rows
      are tagged `unknown_pre_d65`. A probe importing the **deployed** helper
      wrote both cases inside a rolled-back transaction:
      `unavailable=1 reason=ml_unreachable` vs `unavailable=0 reason=null`,
      row count unchanged at 2.
      **STILL BLOCKED on hardware, and the continuation prompt was wrong that
      it is not:** Step 8's "drive one verification" has no hardware-free
      route. `POST /kiosk/deposit` opens a real door; the only alternative
      forges a `kiosk:images` socket event, needing the kiosk shared secret and
      a rental in `AWAITING_DEPOSIT` (there are none). So the four call sites
      firing on a real deposit remains unproven. One real deposit closes it.
- [x] ~~Confirm all 5 cameras are enumerated and which locker each maps to —
      `seedKioskConfig` listed 3 where there are 5 (D-54), so the mapping has
      been wrong in writing before~~ — **DONE 2026-09-11, and the bullet itself
      was wrong: there are FOUR, one per locker.** Both numbers in D-54's note
      (3, and 5) are wrong. All four by-path devices resolve, to exactly the
      four capture nodes: L1→video4, L2→video6, L3→video2, L4→video0. The
      scrambled order is why `USB_DEVICE_MAP` uses stable by-path names instead
      of raw indices — see `docs/PROGRESS.md` → E4.5a, including the false
      alarm I raised and corrected.
- [ ] Capture the deposit frames and the listing photos **side by side** for
      one real item, at the resolution the model actually receives

### E4.5b — A-3, the measurement that unlocks everything else
- [ ] Confidence histogram over real verifications, banded at 85 / 60
- [ ] Automated-vs-human fraction as it stands today
- [ ] Admin override rate, and **which direction** overrides go
- [ ] How often the OCR bonus actually changes a verdict
- [ ] Per-locker breakdown — `ITEM-VERIFICATION-PIPELINE-GAPS.md`'s core claim
      is that every kiosk frame shares one locker interior while listing photos
      do not, so background agreement is being scored as object agreement

### E4.5c — Then, and only then, the auto-approval bar
**Frame it as selective prediction, not as a threshold.** The literature calls
this *selective classification with abstention*: the system may decline to
decide and defer to a human, and the abstention rate is the thing you measure.
The principled way to set the bar is **conformal prediction** — calibrate on
A-3's held-out scores to a **target error rate**, which gives distribution-free
finite-sample coverage, rather than eyeballing 90.
- [ ] State the **cost asymmetry explicitly** before choosing anything. A false
      auto-approve accepts the wrong item back and releases a deposit; a false
      deferral costs an admin thirty seconds. These are not symmetric and the
      bar must not be set as if they were
- [ ] Choose a **target error rate**, then derive the threshold from A-3's
      distribution. Record the achieved automation rate that follows from it
- [ ] Keep the abstain path first-class — PENDING is a real outcome here
      (§3), not a failure
- [ ] Re-measure after any pipeline change: a threshold calibrated on old
      evidence is invalid the moment the evidence changes

### E4.5d — Techniques worth evaluating (from a 2026-09-11 literature scan)
Recorded as candidates **to evaluate against A-3's data**, not as decisions:
- **Instance-level, not class-level, matching.** The real question is "is this
  the same calculator", not "is this a calculator". Micro-texture /
  surface-signature approaches (*SketchPrint*, SPIE/EUSIPCO 2015) identify a
  specific physical object from a phone camera and are the closest published
  match to this problem
- **Foreground segmentation against a per-locker background plate**, already
  proposed in `ITEM-VERIFICATION-PIPELINE-GAPS.md`. The patent literature on
  re-identification does the same thing: segment into estimated foreground and
  background before comparing
- **Geometric verification as a gate, not a score.** SIFT/RANSAC inlier count
  under a consistent homography is a much stronger identity signal than a
  global descriptor distance, and it is already partly in the pipeline
- **Agreement across independent signal families** rather than one weighted
  sum — so a single inflated signal cannot carry a verdict
- **Presentation-attack resistance.** A printed photo currently passes. Any
  auto-approval bar makes that strictly worse, because it removes the human
  who might have noticed

*Sources consulted 2026-09-11: SketchPrint (SPIE 2015 / EUSIPCO 2015); USPTO
re-identification and texture-matching patents; conformal abstention and
cost-sensitive selective prediction literature (arXiv 2607.27143, 2502.07255;
Nature Sci. Rep. 2026).*

## E4.6 — Retrieval: the drop, the bottom door, and lateness

**Added 2026-09-12 from the physical-layer audit (D-67…D-71). RULED by the user
the same day, and the ruling closes all three open questions.** This section is
a specification, not a sketch — it exists because the audit found that the
two-door design is half-built and every recovery path is missing.

### The ruling, in the user's words and what it means mechanically

> *"Actuator activates when a user is late getting their item… admin
> configurable."*
> *"[The bottom door is] for retrieving those items."*
> *"When the owner wants to retrieve, or a user did not get the item on the
> desired time, or the user cancelled and refunded while the item is in the
> kiosk — the actuator will activate, dropping the item. The owner can then
> rescan the QR code for retrieving the item in the bottom door."*

**The bay is two compartments, not one.** That is the thing the old model got
wrong and it explains every dead end in the audit:

| Compartment | Door | Holds |
|---|---|---|
| Upper | `main_door` — **insertion** | the item during a normal rental |
| Lower | `bottom_door` — **retrieval** | an item the system has **released back to its owner** |

**The actuator is the transfer between them.** `place_item` extends — which
drops the item from the upper compartment into the lower — then retracts to
return the platform. So a "drop" is not part of a deposit; **it is the act of
giving an item back**, and it is the missing half of the whole design.

### The release triggers — every path into the lower compartment

A release fires on exactly these, and nothing else:

| # | Trigger | Rental status at the time | Why |
|---|---|---|---|
| R1 | **Renter never collected** | `DEPOSITED`, and now > `depositedAt` + grace | The user's first ruling. Grace is admin-configurable, default **1 hour** |
| R2 | **Owner retrieving a completed return** | `VERIFICATION` | D-68. The owner asks; no waiting period |
| R3 | **Cancelled or refunded while the item is in a bay** | `CANCELLED` with a bay still holding it | The user's third ruling |
| R4 | **Deposit rejected by item verification** | `CANCELLED` via D-67a | The item is not what was listed; it goes back |
| R5 | **Return rejected — a dispute** | `DISPUTED` via D-67b | The owner retrieves pending settlement |

R4 and R5 are the audit's two "sealed in a bay the database calls empty" cases.
**They are the same operation as R1-R3**, which is why this section replaces
D-67's separate fix: there is one release path, not five.

### The state machine this adds

**`LockerStatus` gains `AWAITING_RETRIEVAL`.** A bay whose lower compartment
holds an item **is not `AVAILABLE`** — a second drop onto an un-retrieved item
would stack two students' property in one compartment. This is the single most
important invariant here.

```
AVAILABLE ──deposit──► OCCUPIED ──release──► AWAITING_RETRIEVAL ──owner collects──► AVAILABLE
```

**`Rental` gains a retrieval record**, so the drop is idempotent and auditable:

| Field | Purpose |
|---|---|
| `releaseReason` | which of R1-R5 fired. Without it, an ops person cannot tell a late-collection drop from a dispute drop |
| `releaseRequestedAt` | set **before** the command goes out |
| `releasedAt` | set **only on the Pi's ack**. The gap between the two is how a power failure mid-drop is detected |
| `retrievalLockerId` | which bay to open the bottom door of |
| `retrievedAt` | the owner took it |

### Admin-configurable policy

Stored in the existing `KioskConfig` JSON (`GET`/`PUT /admin/kiosks/:kioskId/config`),
under a new `retrieval` key, so it uses the mechanism that already exists:

```json
"retrieval": {
  "auto_release_enabled": true,
  "collection_grace_hours": 1,
  "release_window_start_hour": 7,
  "release_window_end_hour": 21,
  "owner_retrieval_deadline_hours": 72
}
```

**`collection_grace_hours` is the user's "late for an hour or more".**
**`release_window_*` is the user's "specific hour of the day"** — an item is
never dropped outside opening hours, because a drop puts a student's property
into a compartment that is then unattended until they arrive. An overdue
rental at 03:00 waits until the window opens.

### Foolproofing — the failure modes, each with its guard

This is the part the user asked for. Each row is a way the naive version breaks.

| # | Failure mode | Guard |
|---|---|---|
| F1 | The drop fires twice — the actuator cycles onto an empty platform, or worse, onto a bay reused in between | **Idempotency:** refuse if `releaseRequestedAt` is already set. The DB row, not an in-memory flag |
| F2 | Someone is at the bay with the door open and a hand inside when the actuator fires | **Never release a bay with a live kiosk session or an open door.** Check the session store and the kiosk's own door state before commanding |
| F3 | Power or network fails mid-drop; the row says released, the item is still in the upper compartment | `releasedAt` is written **only on the Pi's ack** (`_run_with_ack` already exists). On kiosk reconnect, reconcile every rental with `releaseRequestedAt` and no `releasedAt` |
| F4 | A drop is attempted into a bay whose lower compartment is already full | The `AWAITING_RETRIEVAL` invariant above, checked in the same transaction that assigns |
| F5 | The wrong person collects — a renter retrieves an item released to the owner | `resolveFaceSubject` must return the **owner** for a retrieval flow. It currently derives subject from `AWAITING_DEPOSIT` only; retrieval is a third case |
| F6 | The owner never comes; the bay is dead capacity forever | `owner_retrieval_deadline_hours` raises an admin escalation. **It does not auto-anything** — an unclaimed physical object is a human decision |
| F7 | An auto-release fires on a bay taken out of service | Skip `MAINTENANCE` / `OUT_OF_SERVICE` |
| F8 | The actuator is commanded but the bay has no calibrated timing | Read from `kiosk_config.json` via the Pi's own default path; never invent a duration server-side (**see D-72**) |
| F9 | Nobody can tell why an item was dropped | `releaseReason` + an audit-log row per release |
| F10 | The drop happens at 3am and the item sits in an unattended open-ish compartment overnight | `release_window_*` |

### D-72 — and it must be fixed BEFORE any of this ships

**A single admin config save destroys the hand-calibrated door and actuator
timings.** `updateKioskConfig` stores whatever it is given and pushes it to the
Pi; the Pi's `on_config` **replaces `kiosk_config.json` wholesale** whenever the
payload has a `lockers` key. `DEFAULT_CONFIG` in `adminController.ts` carries
invented values — `15 / 15 / 5 / 5` for all four bays — against the real
calibration:

| Bay | main | bottom | extend | retract |
|---|---|---|---|---|
| 1 | 15s | 15s | 22s | 22s |
| 2 | **5s** | **5s** | 21s | 21s |
| 3 | 15s | 15s | 17s | 17s |
| 4 | 15s | 15s | 23s | 23s |

Bay 2's door would triple; every actuator would be cut to a fraction of its
calibrated travel time and would stop mid-stroke. `CLAUDE.md`'s hardest rule —
*never change those timings, the hardware is right* — is violable from a button
in the admin console, and **this feature gives admins a new reason to press it.**

### The boxes

- [x] **D-72 DONE 2026-09-12.** `DEFAULT_CONFIG` carries no per-bay timings at
      all and `updateKioskConfig` deep-merges onto the stored config, pushing the
      merged result to the Pi. `adminController.ts` + 10 tests across
      `kioskConfigMerge.test.ts` and `updateKioskConfig.test.ts`, both
      mutation-checked — the second suite exists *because* the first stayed green
      when the merge was swapped for a replace. Pi-side merge-per-key remains a
      follow-up: it is the hardware layer and gets its own change.
- [x] **DONE 2026-09-12.** `prisma/schema.prisma`: `LockerStatus.AWAITING_RETRIEVAL`,
      enum `ReleaseReason` (R1-R5), and the five `Rental` retrieval columns plus a
      `retrievalLocker` relation and a `[releaseRequestedAt, releasedAt]` index.
      **PUSHED TO THE LIVE DATABASE 2026-09-12**, user-authorised, after diffing
      the remote schema to confirm the delta was purely additive (every line an
      addition; nothing on the remote would be lost). `db push` reported *"Your
      database is now in sync… Done in 7.86s"* and the columns were read back:
      5 of 5 on `rentals`, `releaseReason` carrying all five R1-R5 values,
      `lockers.status` now
      `enum(...,'OUT_OF_SERVICE','AWAITING_RETRIEVAL')`, plus
      `rentals_releaseRequestedAt_releasedAt_idx` and the `retrievalLockerId`
      FK. Existing data untouched (5 rentals, 4 bays all AVAILABLE, 0 rows with
      a release requested). The API was **not** restarted and still serves —
      safe because the deployed code predates these columns and nothing can yet
      write `AWAITING_RETRIEVAL`.
- [x] **DONE 2026-09-12.** `services/retrievalPolicy.ts` — pure, no Prisma, no
      socket, no clock of its own. **37 tests**, and F1/F2/F4/F10 plus the grace
      boundary were each individually mutation-checked (guard removed, suite
      watched go red, restored).
- [x] **DONE 2026-09-12.** `services/retrievalService.ts`. Writes
      `releaseRequestedAt` **before** the command, sets the bay
      `AWAITING_RETRIEVAL` immediately, sends `drop_item` with **no durations**
      (the Pi's own calibration is the only correct source — D-72), and writes
      `releasedAt` only from the Pi's `kiosk:ack`, correlated by `command_id`.
- [x] **DONE 2026-09-12, and better than specified:** it runs **hourly**, not
      nightly, because a configurable 1-hour grace period under a daily tick
      would mean "some time tomorrow". The sweep knows none of the rules — it
      hands every uncollected `DEPOSITED` rental to the policy, which applies the
      window, the grace period and every safety guard.
- [x] **DONE 2026-09-12.** A fourth branch, checked **first** because retrieval
      outranks the rental status. It is the only `bottom_door` command in the
      server. Fails closed when the drop was never acknowledged: the item may
      still be in the upper compartment, and opening the bottom door would show
      the owner an empty box and mark their item collected.
- [x] **DONE 2026-09-12.** A released item is the owner's whatever the status
      says. The case that made it necessary: a rejected return leaves the rental
      `DISPUTED` **with the renter still attached**, so the old status-only rule
      would have let that renter face-match into a bottom door holding the item
      just taken back off them. 11 tests; mutation-checked (reverting to the
      status-only rule fails 5).
- [ ] **PARTLY DONE 2026-09-12.** `findUnacknowledgedReleases()` exists and
      `isUnacknowledgedRelease()` is tested, but nothing calls them on kiosk
      reconnect yet. **OPEN:** wire it to the reconnect handler. Deliberately
      surfaces rather than auto-retries — the item may be in either compartment
      and a blind second stroke could push a second item onto the first.
- [ ] **OPEN — admin surface:** the `retrieval` policy on the kiosk config page,
      and the F6 escalation queue
- [x] **DEPLOYED 2026-09-12** — schema migrated and code built and running on
      `desktop-gklhcri` (PID 17884 → 12860, `GET /api/v1/items` HTTP 200,
      no errors). `index.ts` was **patched onto the remote file** rather than
      copied, and the guard was checked after the build: `dist/index.js` still
      has `expiresAt` = 0 hits, so D-66 did not ride along.
- [ ] **BLOCKED — verify on real hardware.** Needs the Pi, a real deposit, and a
      drop driven into the lower compartment. **Deploying is not verifying:** no
      actuator has moved, no bottom door has opened, and the hourly sweep has
      had no candidate (all 5 rentals PENDING/CANCELLED, all 4 bays AVAILABLE).
      No part of this is proven until an item physically changes compartments.

## Definition of done
- [ ] Every beat implemented on both screens, verified on real hardware
- [ ] Screenshot pairs on disk for every beat, both screens
- [ ] **E4.5a proven** — one real deposit traced hop by hop, with an artifact
      at each hop rather than a 200
- [ ] **A-3 measured and written into `docs/PROGRESS.md`**, before any
      threshold moves
