# CONTINUE-E4-SESSION-3.md — paste into a fresh Claude Code session

> Supersedes `CONTINUE-E4-SESSION-2.md` (bannered as superseded).
> Written 2026-09-12 at the end of a session that ran four or five sessions
> long. **E4.6 is designed, ruled, built, migrated and deployed. Nothing in it
> has touched hardware.** A-3 still says there is nothing to measure.

---

**You are resuming the EngiRent redesign track.**

**First: `git branch --show-current` must say `e0-e1-audit-tests-and-evidence`.**
**`main` now tracks this branch** — the user merged and pushed it on 2026-09-12,
so the two are equal and pushing is authorised. It is a **public** repo: run G6
before the first commit, every session.

Read, in this order, and **only** these:

1. `CLAUDE.md` — note the new first hard rule, **G11**.
2. `docs/redesign/ENGIRENT-CLAUDE.md`
3. `docs/PROGRESS.md` — the STATUS LINE, the CONTEXT DEGRADATION LOG (**eleven
   gates now**), then the two **2026-09-12** entries.
4. `docs/redesign/CLAUDE-CODE-PLAYBOOK.md` §2c-2d — **G1-G11.**
5. `memory.md` — the **2026-09-11** and **2026-09-12** entries.

Then `docs/redesign/phases/E4-kiosk-handoff.md`, especially **E4.6**.

**Open every response with the status line. End every session with
`npm run report` (G10).**

---

## G11 — READ THIS BEFORE YOU TOUCH ANYTHING

**Added by the user 2026-09-12: notify them BEFORE any physical test, always.**

The bank is a Pi driving 8 solenoids and 4 actuators in a **public corridor,
normally unattended**. A door opened with nobody there stays open, with a
student's property in it.

**Physical means:** `open_door` (either door), `drop_item`, `actuator_extend`,
`actuator_retract`, `lock_all`, **`self_test`** (it pulses everything),
`POST /kiosk/deposit|claim|return`, `POST /admin/kiosks/:kioskId/command`, and
**`scripts/e2e-full-lifecycle.mjs`** — which calls `POST /kiosk/deposit` and
opens a real door.

**Stop, say what will move, which bay and for how long, and wait for an explicit
yes.** Approval earlier in a session does not carry — the human may have walked
away from the bank.

---

## Where things actually are

**E4.6 — the retrieval feature — is BUILT, MIGRATED and DEPLOYED.** Do not
rebuild it. Re-derive before trusting this (G3), but as of 2026-09-12:

- **Live database:** `LockerStatus.AWAITING_RETRIEVAL`, enum `ReleaseReason`
  (R1-R5), five `Rental` retrieval columns, the index and the FK. Read back
  after `db push`.
- **Live server:** `retrievalPolicy.ts` (pure, 37 tests), `retrievalService.ts`,
  the R4/R5 rejection paths, the hourly collection sweep, the `bottom_door`
  retrieval branch, and `resolveFaceSubject`'s F5 case. PID 17884 → 12860.
- **D-72 fixed:** the server no longer ships per-bay timing defaults and config
  updates deep-merge. `kiosk_configs` has **0 rows**, so the gun was never
  fired and the Pi still holds its original calibration.

**What is NOT proven, and deploying did not change it:** no actuator has moved,
no bottom door has opened, and the hourly sweep has had no candidate. **G1 debt
is 3.**

## The one physical run that collapses most of the backlog

**You must ask first (G11).** Then:

```
node scripts/e2e-full-lifecycle.mjs <path-to-a-real-face.jpg>
```

It does **10 sections** unattended — two students, ID verification, an item, a
rental, both payments, admin approval — and then calls `POST /kiosk/deposit`,
which picks an AVAILABLE bay and opens `main_door` **with no face scan needed**.

The human's part is ~2 minutes: place an object during the ~20s window, collect
it later. **Pair bay 2 (5s door) with any other (15s)** — any other pairing
passes a sync test that proves nothing.

That single run gives: the deposit path exercised, **A-3's first interpretable
row**, and a bay in a state the collection sweep can act on so a drop can be
watched for real.

## What is NOT blocked — and it is most of the project

The hardware blocks E4.4/E4.5/E4.6 *verification*. It blocks almost nothing else.

| Work | Boxes | Needs the bank? |
|---|---|---|
| **E5 — Flutter app** | 19 | No |
| **E6 — Admin console + remaining kiosk screens** | 31 | No |
| **E7 — Website + sign-off** | 17 | No |
| **69 screens at 0 PASS** | — | No. **This is where the distance is** |
| E4.1 — the kiosk never names *who* it waits for | 1 | Build no, verify yes |
| E4.2 — QR freshness has no ring/bar | 1 | Build no |
| E4.3 — no live framing feedback on the phone | 1 | Build no |
| **D-63** admin bay card's OCCUPIED/stuck branches | — | **No** — blocked only by CORS on localhost. Ask for the current admin tunnel URL and this debt clears |
| **D-64** app says "all lockers occupied" when they may be out of service | — | No |
| E4.6's admin UI for the retrieval policy, and F3's reconnect wiring | 2 | No |

**The kiosk UI runs in Vite dev mode**, so kiosk screen work does not need the Pi.

## Open, needing the human

1. **The physical run above** — G11 applies.
2. **D-66:** the server still runs a pre-E3.2 `index.ts`. `dist/index.js` has
   `expiresAt` = **0 hits**, so the phone's 120s countdown is not live. Ruled to
   get its **own** deploy, because it also drops four admin socket events
   (D-37b). The remote `index.ts` is diverged — **scp down, patch onto it, diff,
   scp back**; never copy the branch file over.
3. **D-65** is deployed but not closed — its four write sites need one real
   deposit.
4. **C: disk** was at 98% at last check.

## Operational facts that cost real time

- **The live DB is MySQL `engirent` at `127.0.0.1:3307`, local to the server.**
  The repo's `.env` points at a dead Aiven host (NXDOMAIN). Nothing reaches
  production from the dev PC.
- **`prisma db push` runs `generate` at the end and it fails `EPERM` while the
  API is running.** The push still succeeds and the client stays **stale**.
  Stop the API, *then* `npm run build`.
- **Restart is proven by the PID on port 5000 changing**, never by is-active.
  ~30-45s to come back.
- **An open port is not a working API, and the prefix is `/api/v1`.** `/health`
  and `/items` both 404. `GET /api/v1/items?limit=1` is the check.
- **CRLF:** `src/index.ts` is CRLF locally, LF on the remote. Normalise on read,
  restore on write, or your patterns match zero times.
- **`Tests: 0 total` from a mutation check is a COMPILE FAILURE, not a pass.**
  This bit three times in one session. Re-run it properly.
- **D-62:** `pkill -f "chromium.*--app=..."` kills the kiosk supervisor too. Use
  `pkill -f "^/usr/lib/chromium/chromium"` or restart the service.
- **Ports:** Node 5000, ML 8001, admin 3001, web 3000.

## Tooling — use it, don't rebuild it

```
npm run report                                   # G10
npm run render:diagrams                          # 16 process sheets -> docs/diagrams/
node design/tools/verify-diagram-svg.mjs <svg> <png>
node design/tools/probe-reduced-motion.mjs
node design/tools/contrast-kiosk-live.mjs
node design/tools/capture-kiosk-live.mjs
node design/tools/probe-admin-bays.mjs
```

## Credentials — gitignored, never in a tracked file

`.env.local` at repo root: `TEST_STUDENT_*` (Chester Testinggton — **its email
must never change, five e2e suites match it**) and `KIOSK_SUDO_PASSWORD`.
`client/admin/.env.local`: `ADMIN_EMAIL` (`admin@engirent.edu.ph`) /
`ADMIN_PASSWORD`.

**Do not pull a password into session context.** G7 makes you commit a
continuation prompt to a public repo; that is how S-3 was published. Point at
the file. **Secrets over STDIN, never argv** — argv is world-readable on the Pi.

## Session-length note, and it is not boilerplate

The 2026-09-12 session ran **four or five sessions long** and symptom 6 fired
three times. **One section per session, `/clear` between.**
