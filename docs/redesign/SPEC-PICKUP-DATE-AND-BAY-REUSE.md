# SPEC — Pick-up date, verification lanes, and bay reuse

> **Status: SPECIFIED, NOT IMPLEMENTED.** Written 2026-09-18 from the user's
> ruling, during the first physical test run. No code in this repo implements
> any of it yet. Nothing here has been built, deployed or verified.
>
> **Written for:** whoever implements this next — most likely a later session
> reloading from `docs/PROGRESS.md`. It assumes the reader knows the D-87b
> two-tier verification and the E4.6 retrieval design, and it deliberately
> records the open questions instead of inventing answers to them.

## 1. The ruling, in the user's terms

1. The **renter** sets a **pick-up date** when they book.
2. If the pick-up date is **more than one day away**, the deposit is checked by
   the **full verification run** only — the fast lane does not get to decide.
3. If the pick-up date is **today**, behaviour is unchanged from D-87b/D-87d:
   the fast check runs at the locker, and a `PENDING` result is resolved either
   by the full run clearing it (≥ 85) or by a human.
4. For a **more-than-one-day** deposit, once the full check has finished the
   item is **dropped into the lower compartment**, so the **upper bay is free
   for another hand-off**.
5. A locker whose **top and bottom compartments are both occupied** is
   **locked** — not assignable to anything new.

## 2. Why this is a good idea, stated plainly

Today a deposit occupies a whole locker from drop-off until collection. With 4
bays, four long-lead rentals exhaust the entire bank, and a student wanting a
same-day hand-off is refused because someone else's multimeter is sitting in a
bay until Friday.

Rule 4 converts the lower compartment into **storage** and keeps the upper bay
as the **transaction surface**. That roughly doubles usable capacity without
touching the hardware. Rule 3 is what makes rule 4 safe: nobody is standing at
the locker waiting for a long-lead deposit, so there is no reason to accept a
degraded verdict on it — spend the 35 seconds and get the real answer before
the item is committed to storage.

Rule 5 is not a separate idea. It is the existing invariant, extended. The
schema already says it, at `LockerStatus.AWAITING_RETRIEVAL`:

> *"dropping a second item onto an un-retrieved one would stack two students'
> property in one compartment. This is the single most important invariant in
> the retrieval design."*

A bottom compartment holding a long-lead item is in exactly that position.

## 3. What the hardware actually gives us

Re-derived from `server/kiosk/kiosk_config.json` — **never edit those timings,
they are hand-calibrated** (`CLAUDE.md`):

| per bay | seconds |
|---|---|
| `main_door_open_seconds` | 15 (bay 2: 5) |
| `bottom_door_open_seconds` | 15 (bay 2: 5) |
| `actuator_extend_seconds` | 22 (bay 2: 21) |
| `actuator_retract_seconds` | 22 (bay 2: 21) |

So each of the 4 bays is: a **top compartment** behind `main_door`, a **bottom
compartment** behind `bottom_door`, and an **actuator** that moves an item from
top to bottom. A drop costs ~44s of actuator travel. `requestRelease`
(`services/retrievalService.ts`) already performs exactly this motion to return
a rejected deposit to its owner, so **rule 4 needs no new hardware capability**
— only a new reason to invoke one that exists.

## 4. The blocking design problem

`model Locker` carries **one** `status` and **one** `currentRentalId`:

```prisma
status          LockerStatus @default(AVAILABLE)
currentRentalId String?
```

It therefore **cannot represent "top empty, bottom holds rental X"** — which is
the entire point of rule 4. This is the first thing to fix and everything else
depends on it.

Two options:

**(a) Two compartments as first-class columns** on `Locker`:
`topStatus`/`topRentalId`, `bottomStatus`/`bottomRentalId`, with `status`
derived for compatibility. Keeps one row per physical bay, which matches the
hardware and keeps the calibration lookup (`kioskTimingStore`) unchanged.

**(b) A `LockerCompartment` table**, two rows per bay. Cleaner in the abstract,
but every existing query, the occupancy broadcast (`lockerOccupancyService`),
the kiosk's `Occupancy updated` payload and the admin console all key off
`lockerNumber` → one row. More churn for the same result.

**Recommendation: (a).** The hardware is fixed at two compartments per bay;
modelling it as an open-ended collection buys generality nobody will use, and
option (b) touches far more of the live surface for no behavioural gain.

## 5. Consequences that must be designed, not discovered

Listed because each one is a way this feature could ship and then hurt someone.

1. **Collection moves to the bottom door.** A long-lead item lives in the
   bottom compartment, so the claim flow must open `bottom_door`, not
   `main_door`. `faceVerificationService`'s claim branch currently hardcodes
   `door: "main_door"`. Getting this wrong means a renter is granted access to
   an empty compartment while their item sits behind the other door.
2. **A rejected long-lead deposit must not be dropped for the renter.** If the
   full run fails, the item belongs back with the **owner** — which is also a
   drop to the bottom, but labelled for a different person. The bottom
   compartment therefore needs to record *whose* item it is and *why* it is
   there, or an owner and a renter can both be granted the same door.
3. **"Above one day" needs a definition.** Strictly more than 24h from deposit,
   or "not today" by calendar date? These differ for a 23:00 deposit with an
   08:00 next-morning pick-up. The user's phrasing ("If the pick up date is
   Today") suggests **calendar date in the kiosk's local timezone**, which is
   also the one a student would reason about. Confirm before building.
4. **Can the pick-up date change after deposit?** A renter who set Friday and
   now wants it today would need the item moved from the bottom back to the top
   — the actuator retracts, but nothing models that transition, and it cannot
   happen while another hand-off occupies the top.
5. **Uncollected long-lead items.** E4.6's collection sweep releases
   uncollected deposits. A bottom compartment that is *supposed* to hold an
   item for four days must not be swept as abandoned on day one.
6. **Capacity accounting gets subtler.** `assignLocker` filters
   `{ status: "AVAILABLE", isOperational: true }`. Under this feature the
   question becomes "is the TOP free", and separately "is there a bottom slot
   for it to be dropped into later" — assigning a long-lead deposit to a bay
   whose bottom is already full creates an item with nowhere to go after its
   check passes.
7. **The renter must be told the date matters.** If a pick-up date silently
   changes which compartment their item ends up in and how long confirmation
   takes, it has to be presented as a real choice with real consequences, not
   an optional field.

## 6. Implementation order (proposed)

Each step is independently verifiable on screen, which is the point.

| # | step | surface |
|---|---|---|
| 1 | `Rental.pickupDate` (nullable), additive | schema |
| 2 | Two-compartment state on `Locker`, per §4(a) | schema |
| 3 | Lane selection: pick-up date → `fast` or `full` only | `index.ts` deposit branch |
| 4 | Drop-after-full-check, reusing `requestRelease`'s motion | `deepReviewQueue` + `retrievalService` |
| 5 | Assignability: top-free AND a bottom slot; lock when both full | `faceVerificationService.assignLocker` |
| 6 | Claim opens the compartment that holds the item | `faceVerificationService` claim branch |
| 7 | Pick-up date picker + "why this matters" copy | Flutter booking flow |
| 8 | Two-compartment occupancy in the console and on the kiosk | admin + kiosk UI |

Steps 1–2 are additive and safe. **Step 4 drives an actuator**, so it is
subject to **G11** — it cannot be tested without telling the human which bay
will move and waiting for an explicit yes.

## 7. What is NOT decided here

- Whether a long-lead deposit should also be allowed a fast check purely for
  early feedback to the owner (harmless, but adds a second verdict per row).
- Whether the bottom compartment should hold more than one item. The schema
  invariant in §2 says no; the physical compartment may or may not agree, and
  that is a question for the person standing in front of it.
- Anything about pricing or fees for longer storage.
