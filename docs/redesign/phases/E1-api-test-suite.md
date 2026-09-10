# E1 — Full API + Socket Test Suite

**Goal:** make "the API is proven working" repeatable and automated instead of
true-because-someone-remembers. Build per `API-TEST-PLAN.md` in full.

> **UPDATED 2026-09-06 from E0's findings — read before starting.** Four items
> below were already done, one is wrong, and E0 found defects that change what
> this phase must prove.

## Corrections from E0

**Already done — do not redo:**
- **The socket emit/consume audit is complete.** 21 socket.io events; **5 have
  no consumer** (`admin:kiosk_online` / `_ack` / `_status` / `_error`, because
  the admin console has no socket client at all; and `kiosk:rental_info`, whose
  consumer was deliberately deleted 2026-09-03). Two listeners had no emitter —
  `kiosk:face` and `qr_scanned` — and the code behind the latter was removed.
  Full result in `docs/PROGRESS.md`.
- **The endpoint register is built** — all **93** endpoints enumerated from the
  route files, not from `Implemented.md`.
- **The self-action sweep is done and it found nothing.** D-3's predicted
  pattern does **not** repeat: reviews, messaging and refunds all derive the
  counterparty from the rental. **But that safety is transitive** — it rests
  entirely on `rentalController.ts:40`. So the test to write is not "can I
  review my own item" (structurally impossible) but **"does the derived
  counterparty stay correct if that guard changes"**.

**Wrong in the original text:**
- The e2e scripts are at **`server/node_server/scripts/e2e-*.mjs`**, not a
  repo-root `scripts/`. There are 10 of them. Jest has **6** files, not 4.
- `API-TEST-PLAN.md`'s endpoint group counts are short by one in four groups
  (auth 11→**12**, rentals 7→**8**, kiosk 7→**8**, notifications 5→**6**).
  Testing "every endpoint" from those counts would silently miss four.

## Defects this phase must now cover

E0 fixed some and found others. Each needs a regression test here:

- **D-15 — malformed JSON returns 500, not 400, on every JSON endpoint.** This
  is one shared fix, not 93 separate ones, but it is the "clean 400" case in
  all 93 rows. **Fix it first**, or every row fails for the same reason.
- **D-1 (fixed)** — assert the **login response shape** carries
  `verificationStatus`/`Reason`/`Note`. The client-side unit tests pass without
  it; that is exactly how the bug survived its first fix.
- **D-3** — the derived-counterparty tests above.
- **D-18 (fixed)** — assert `runMlVerification` returns `unavailable: true`
  when references cannot be downloaded, and does **not** return a bare PENDING
  that looks like a real verdict.
- **D-17 (fixed)** — assert item media round-trips as a **relative path** and
  is rebuilt against the current host, so a hostname change cannot break it.
- **D-25 / D-23** — the payment path: mock-confirm is unreachable under
  `NODE_ENV=production`, and `POST /payments` must not fail silently.
  **Half done:** `scripts/e2e-webhook-signature.mjs` asserts the production
  refusal live (D-25 reconfirmed, not remembered). The `POST /payments`
  silent-failure half (D-23) still needs its test.
- **D-26 / D-28** — settlement writes a ledger row in **every** branch,
  including `payoutReady && !PAYMONGO_SECRET_KEY`, and a payout attempted before
  funds clear is queued rather than reported to the owner as failed.

> **STATUS RECONCILIATION, 2026-09-11 (P-1).** Until today this file's boxes
> were never ticked as work completed — `docs/PROGRESS.md` was the running
> record and this stayed a plan. That made the file unreadable as status: a
> reader could not tell "done", "ruled deferred" and "genuinely open" apart.
> Every box below has now been checked against the repo, once. **Boxes left
> open are open on purpose and say why.** `docs/PROGRESS.md` remains
> authoritative where the two ever disagree.

---

## Prerequisite

`GET /payments/receiving-institutions` and every Disbursements-dependent route
**cannot pass** until PayMongo enables Disbursements. Mark them blocked rather
than counting them as failures — see `PAYMENTS-AND-PAYOUTS-REVAMP.md`.

---


- [x] ~~Extend the existing real-HTTP `server/node_server/scripts/e2e-*.mjs` approach — **not** the
      mocked-Prisma unit tests, which proved less useful in practice~~
      — **DONE.** **17** `e2e-*.mjs` suites on disk (`e2e-all`, `auth-matrix`,
      `availability`, `coverage-sweep`, `defect-regressions`,
      `enterprise-hygiene`, `feedback`, `full-lifecycle`, `item-moderation`,
      `kiosk-trust`, `listing-video`, `messaging`, `my-listings`,
      `self-action`, `trust-safety`, `verification`, `webhook-signature`).
      13/13 runnable suites green, 383 assertions — see the one-command entry
      below.
- [ ] Every endpoint gets the five minimum cases (happy path, missing auth,
      wrong role, malformed body, self-action rejection where applicable)
      — **GENUINELY OPEN, and this is why E1 was closed "with named gaps"
      rather than complete.** Measured across the 93-row register
      (`docs/PROGRESS.md` → "Computed coverage across 93 rows"): happy path
      **73/93 (78%)**, 401 asserted **34**, 403 asserted **12**,
      malformed-400 empirically sampled **7** (the rest carried by the shared
      `errorHandler` fix, D-15, or n/a for bodyless routes), self-action
      **5**. **All 21 uncovered rows are named with a reason** in the endpoint
      register. Carried forward deliberately on the user's ruling 2026-09-11;
      closing it is a large detour and each gap is already attributed.
- [x] ~~Every specifically-risky item in `API-TEST-PLAN.md` gets a named test —
      the kiosk session trust boundary especially: **test it by attacking it**~~
      — **DONE 2026-09-06.** Kiosk session store (9 + 9 Jest, 11 live
      assertions incl. socket attacks with two controls), QR TTL/single-use (15
      stdlib-unittest tests on the kiosk), PayMongo webhook signature (11 live,
      with a real PENDING transaction re-read as the state control), ML 85/60
      boundaries (53 pytest). Every one mutation-checked. Detail and the
      commands in `docs/PROGRESS.md` → "Risky-item coverage".
- [x] ~~Socket emit/consume audit~~ — **done in E0**, 5 unconsumed events found
- [x] ~~**Watch the self-action tests fail before fixing them** (D-3's
      generalization) — a test that never failed proves nothing.~~
      — **DONE 2026-09-06.** The body of this bullet is itself the completion
      record: the method was settled and applied, the six mutations listed
      below were made, the tests watched to go red, and the source restored.
      The box was simply never ticked.
      **Method settled for the risky-item tests, reuse it:** where the code was
      already correct there is nothing to watch fail, so the source was
      deliberately mutated (trust the client's `kioskId`; delete the
      session-owner check; TTL 120s → 600s; cap 4 → 99; drop the QR
      single-use invalidation; `ML_THRESHOLD_VERIFIED=80`), the tests watched
      to go red, and the source restored. **A test that has never been red
      proves nothing, whether or not there was a bug to fix.**
- [x] ~~One command runs the suite; documented in the README~~ — **DONE
      2026-09-06.** `scripts/e2e-all.mjs` (`--list` / `--safe` / `--only=`) and
      `scripts/run-e2e-all.ps1` for the server, where nine DB-touching suites
      can actually run. **13/13 suites green, 383 assertions**, and the
      database is byte-for-byte unchanged before and after. Ten suites had to
      be taught the rate-limit bypass header first — without it the run dies in
      429s from `enterprise-hygiene` onward, and the 429s cascade into Prisma
      validation errors that look like code defects and are not. Documented in
      `server/node_server/README.md` -> Testing.
- [x] ~~Endpoint register built~~ — **done in E0** (93 rows). This phase fills in *test status* per row, and names every failure

## Definition of done
- [ ] Full coverage per the plan; suite runs clean or every failure is
      recorded and attributed
      — **HALF MET, and the halves differ.** *"Suite runs clean / every
      failure attributed"* is **met**: 13/13 suites green, 383 assertions,
      database byte-for-byte unchanged before and after. *"Full coverage per
      the plan"* is **not** met — 73/93 happy path, see the five-minimum-cases
      row above. Left open because the coverage half is genuinely outstanding.
- [x] ~~Socket audit complete, unconsumed events listed for E2~~
      — **DONE in E0**, and this row is a duplicate of the ticked
      "Socket emit/consume audit" above. `docs/PROGRESS.md` →
      "SOCKET EMIT/CONSUME AUDIT (E0.2 / D-6 pattern 3) — COMPLETE";
      5 unconsumed events found and carried into E2.
