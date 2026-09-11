> # SUPERSEDED 2026-09-12 by `CONTINUE-E4-SESSION-3.md`. Kept per REPO-HYGIENE.
> **Out of date in six places.** Since it was written: E4.6 (the actuator drop,
> AWAITING_RETRIEVAL and the bottom-door retrieval) was ruled, built, migrated
> and deployed; D-72 was found and fixed; D-67..D-71 were addressed in code;
> `main` now tracks this branch and pushing is authorised; and **G11 was added —
> never drive the hardware without telling the human first.** Use session 3.

# CONTINUE-E4-SESSION-2.md — paste into a fresh Claude Code session

> Supersedes `CONTINUE-E4-SESSION-1.md` (bannered as superseded).
> Written 2026-09-11. **D-65 is DEPLOYED to the live database and API and is
> NOT closed. A-3 is measured and says there is nothing to measure. E4.5c
> stays shut. The binding constraint on everything left in E4 is one real
> deposit.**

---

**You are resuming the EngiRent redesign track in E4.**

**First: `git branch --show-current` must say `e0-e1-audit-tests-and-evidence`.**
**`main` has none of this work and you must NOT push** — the repo is public and
pushing would republish S-3/S-5 history and a real student's photos from
`design/before/`. If you are on `main`, stop and tell the user.

Read, in this order, and **only** these:

1. `CLAUDE.md`
2. `docs/redesign/ENGIRENT-CLAUDE.md`
3. `docs/PROGRESS.md` — the STATUS LINE, the CONTEXT DEGRADATION LOG, then the
   **2026-09-11 (E4.5a, session 2)** entry at the top.
4. `docs/redesign/CLAUDE-CODE-PLAYBOOK.md` §2c-2d — **ten gates, G1-G10.**
5. `memory.md` — the **two 2026-09-11** entries. The later one has the live
   database's real location and the `db push` ordering trap.

Then `docs/redesign/phases/E4-kiosk-handoff.md`.

**Open every response with the status line from `PROGRESS.md`.**
**End every session by showing `npm run report` (G10).**

---

## Read this before you plan anything

**Almost everything left in E4 is gated on a human at the kiosk, not on code.**
That is the honest shape of the phase, and the last two sessions both
rediscovered it the slow way. The report says `BLOCKED 1` for E4 and that line
is the most actionable one in the whole track.

**The single instruction that would unblock the most work:** one real deposit —
a door driven, an item physically placed, at **locker 2 (5s door) paired with
any other (15s)**. That one act closes D-65's remaining half, feeds A-3 its
first interpretable row, and is the only way E4.4's sync test can pass
meaningfully.

---

## D-65 — DEPLOYED 2026-09-11, NOT CLOSED. Do not redo it.

Re-derive before trusting this (G3), but as of 2026-09-11:

- `Verification` has `unavailable Boolean @default(false)` and
  `unavailableReason String?` **live in the production database**.
- `src/services/verificationEvidence.ts` is the one place those fields are
  produced; all **four** `prisma.verification.create` sites in `src/index.ts`
  spread `verificationEvidenceFields(mlResult)`; both ML-unreachable catch
  blocks build `mlUnreachableResult()`.
- 12 tests in `src/services/__tests__/verificationEvidence.test.ts`,
  **mutation-checked**. One of them walks `index.ts` and asserts every write
  site carries the spread — if you add a fifth write site, that test tells you.
- Deployed and rebuilt on `desktop-gklhcri`; restart proven by **PID change**.
- The two 2026-09-03 rows are tagged `unavailableReason = 'unknown_pre_d65'`.

**What is still open on it:** the four call sites firing on a **real deposit**.
Nothing short of a door proves that. When it happens, read the row and close
D-65 in the register.

**For E4.5c, when it eventually opens — the calibration exclusion filter is**

```sql
WHERE unavailable = 0 AND unavailableReason IS NULL
```

**not `WHERE unavailable = 0`.** The two tagged rows carry `unavailable = 0`
with a non-NULL reason precisely because nobody knows why they scored zero.
The narrower filter readmits exactly the ambiguity D-65 exists to remove.

---

## D-66 — NEW, and it changes what "verified" can mean in E4

**The server is running an `index.ts` that predates E3.2 and D-37(b).**
Confirmed against the **built artifact**, not the source:

```
D:\ENG\EngiRent\server\node_server\dist\index.js
  expiresAt                   0 hits
  admin:kiosk_online          1 hit
```

- E3.2 sends the 120s session deadline as an **absolute epoch-ms** value on
  `kiosk_session_started` so the phone's countdown cannot drift. **Not
  deployed.** PROGRESS.md's E4 G2 table lists that beat under *"Done already"* —
  true of the repo, false of the product.
- D-37(b)'s removal of the admin socket's kiosk telemetry: **not deployed.**

**Consequence for E4.1's Verifying beat: it cannot be verified on real
hardware until the server is brought up to the branch.** The user ruled
2026-09-11 that D-66 gets its **own** deploy rather than riding along with
D-65, because dropping four admin socket events changes a contract and deserves
its own verification pass.

**When you do it:** the remote `index.ts` is diverged — `scp` it down, apply
onto it, diff to confirm the delta, `scp` back. The remote `schema.prisma` was
byte-identical to branch HEAD on 2026-09-11; **diff it again** before assuming
that still holds.

---

## Operational facts that cost time to learn — do not re-derive these

- **The repo's `server/node_server/.env` `DATABASE_URL` is DEAD** (Aiven host,
  NXDOMAIN). The real database is **MySQL `engirent` at `127.0.0.1:3307`,
  local to `desktop-gklhcri`**. Nothing reaches production from the dev PC.
  Reading the server's `.env` is refused by the classifier (*Production
  Reads*) — let `prisma db push` print the datasource instead.
- **`prisma db push` runs `prisma generate` at the end and it fails `EPERM`
  while the API is running** (the live process holds
  `query_engine-windows.dll.node` open). The push succeeds; the client stays
  **stale**; the failure then surfaces at runtime on the next write — i.e. at a
  locker. Stop the API, *then* `npm run build`.
- **Restart is proven by the PID on port 5000 changing**, never by an
  is-active-style check. `Get-NetTCPConnection -LocalPort 5000 -State Listen`.
  It takes ~30s to come back.
- **An open port is not a working API, and the prefix is `/api/v1`.**
  `/health`, `/` and `/items` all 404 and prove nothing.
  `GET /api/v1/items?limit=1` returning item JSON is the check.
- **There is no hardware-free way to create a `Verification` row.**
  `POST /kiosk/deposit` drives the real Pi; the only alternative forges a
  `kiosk:images` socket event needing the kiosk shared secret **and** a rental
  in `AWAITING_DEPOSIT` (there are none). To prove a persistence change without
  a door: import the **deployed** helper from `dist/` and write inside a
  `$transaction` you deliberately throw out of, then assert
  `verification.count()` is unchanged.
- **CRLF bit again.** `server/node_server/src/index.ts` is CRLF; the remote
  copy is LF. Normalise on read, restore on write, or your patterns match zero
  times — or worse, you rewrite the whole file and the diff looks like you
  shipped something enormous.
- **D-62: `pkill -f "chromium.*--app=http://localhost:8080"` kills the kiosk
  supervisor too.** Use `pkill -f "^/usr/lib/chromium/chromium"` or restart the
  service.
- **Port map:** Node **5000**, ML **8001**, admin **3001**, web **3000**.

---

## What needs the human — hand these over, do not wait on them silently

1. **One real deposit.** Locker 2 (5s) paired with any other (15s). Closes
   D-65, starts A-3's distribution, and is the only meaningful E4.4 sync test.
2. **D-66's deploy** — ruled as its own trip.
3. **G1 debt: D-63's admin UI.** The endpoint is deployed and verified live
   (proven *unfiltered*). The card was seen rendering real state, but its
   `OCCUPIED` / non-operational / **"occupied with no rental — the stuck case"**
   branches have **not** been seen. Playwright interception did not fire and
   localhost is CORS-rejected because the allowlist is built from
   `CLIENT_ADMIN_URL`. **The unblock is a CORS allowlist entry for localhost,
   or the current admin tunnel URL.**
4. **C: disk** was at 98% (14 GB free) as of the last check — it crashed two
   emulators and failed an APK build that then succeeded unchanged.

## E3's two remainders, unchanged

- **Locker representation** — kiosk half done (D-53 closed on live hardware);
  app and admin are not on one shared model. **D-64**: the app says *"All
  kiosk lockers are currently occupied"* when they may be out of service.
- **Loading primitives** — `socket_client.py` must send `duration_seconds` so
  the kiosk's determinate bar has a real duration. Until then it renders
  indeterminate, **never a guessed bar**. Verifying it needs a real door cycle.

## E4.5c stays shut, and saying so is the correct answer

A-3 measured: `Verification` rows **2**, both `confidence 0`, rentals that ever
reached DEPOSITED/ACTIVE/COMPLETED **0**. **The ≥90% auto-approve bar cannot be
set.** This is *selective classification with abstention*; the principled method
is conformal calibration to a target error rate, which needs a score
distribution that does not exist. Producing a number would be the easy,
agreeable, wrong answer. Do not.

## Tooling that exists — use it, don't rebuild it

```
npm run report                              # G10 phase report
node design/tools/probe-reduced-motion.mjs  # control-experiment, any surface
node design/tools/contrast-kiosk-live.mjs   # WCAG sweep vs the live kiosk
node design/tools/capture-kiosk-live.mjs    # drive the real kiosk at 1080x1920
node design/tools/probe-admin-bays.mjs      # admin bay-state card
```

## Credentials — all gitignored, never in a tracked file

`.env.local` at repo root: `TEST_STUDENT_*` (Chester Testinggton — **its email
must never change, five e2e suites match it literally**) and
`KIOSK_SUDO_PASSWORD`. `client/admin/.env.local`: `ADMIN_EMAIL`
(`admin@engirent.edu.ph`) / `ADMIN_PASSWORD`.

**Do not pull a password into session context.** G7 makes you write a
continuation prompt that gets committed to a **public** repo — that is the
mechanism that published S-3. Point at the file; let the user read it.
**And pass secrets over STDIN, never argv** — argv is world-readable on the Pi.

## Session-length note

**One E4 section per session, `/clear` between.** The last two sessions both
ran long, and both spent their tail rediscovering that the remaining work is
hardware-gated.
