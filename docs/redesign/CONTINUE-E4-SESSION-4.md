# CONTINUE-E4-SESSION-4.md — paste into a fresh Claude Code session

> Supersedes `CONTINUE-E4-SESSION-3.md` (bannered as superseded).
> Written 2026-09-13 at the end of a session that became a **brownout recovery**
> halfway through. E4.2 is done, D-63 is closed, S-8 was found and fixed.
> **Nothing has touched a door or an actuator.**

---

**You are resuming the EngiRent redesign track.**

**First: `git branch --show-current` must say `e0-e1-audit-tests-and-evidence`.**
`main` tracks it and pushing is authorised. It is a **public** repo: run G6
before the first commit, every session. **This session's commits are NOT
pushed** — check `git log origin/main..HEAD` and push if the user wants it.

Read, in this order, and **only** these:

1. `CLAUDE.md` — G11 is the first hard rule.
2. `docs/redesign/ENGIRENT-CLAUDE.md`
3. `docs/PROGRESS.md` — the STATUS LINE, the CONTEXT DEGRADATION LOG (its
   **2026-09-13** entries), the **2026-09-13** section, **D-63** and **S-8**.
4. `docs/redesign/CLAUDE-CODE-PLAYBOOK.md` §2c-2d — **G1-G11.**
5. `memory.md` — the **2026-09-13 SECOND BROWNOUT** entry. All of it.

Then `docs/redesign/phases/E4-kiosk-handoff.md`, **E4.6**.

**Open every response with the status line. End every session with
`npm run report` (G10).**

---

## FIRST: the stack is probably in a half-recovered state. Re-derive it.

**Standing instruction (user, 2026-09-13): every outage gets written into
`memory.md` where a `/clear` cannot eat it** — not only into a reply.

A liveness fact on this project expires in minutes. As of writing:

| Thing | State at hand-off | How to re-check |
|---|---|---|
| Server PC | rebooted 13:23 after a brownout; EngiRent stack restarted 15:01; Node **PID 11700**; API 200 local + public | PID on port 5000 — **never quote the old one** |
| **Tunnel URLs** | **NOT re-pointed.** The classifier refused the `.env` edit twice; the user's "continue" was not explicit enough. **CORS rejects the live admin and web origins** (proven: the API sends ACAO for the dead old admin host, none for the live one) | See memory.md 2026-09-13 for the exact keys and hostnames |
| Kiosk router `192.168.1.1` | **no internet** (measured from the Pi and from the server's Ethernet) | only the user can fix it — power-cycle router or modem |
| Kiosk Pi | booted fine, controller running, **off Tailscale** (keeps its node key — should rejoin with no re-login once internet is back), clock 2 days behind | via the LAN jump below |
| Kiosk screen | kiosk app runs on **console 7**. The user was last on console 1 | Ctrl+Alt+F7 |

**Another project shares the server PC.** EcoCharge runs on ports
**30010-30014** with its own tunnels. A healthy node/python/cloudflared process
list is **not** evidence EngiRent is up. Check EngiRent's ports.

### Reaching the Pi when Tailscale is down on it

The dev PC is on another site. The **server PC's Ethernet shares the kiosk
LAN**. Jump through it and verify against the key already trusted:

```
ssh -o HostKeyAlias=engirent-kiosk -o StrictHostKeyChecking=yes -J transfer@desktop-gklhcri engirent@192.168.1.65 '...'
```

The IP is DHCP; it was `.65`. **Never disable host-key checking.** Anything
that restarts `engirent-kiosk.service` or drives a door is **G11**.

## G11 — unchanged, and read it before touching anything

**Physical:** `open_door` (either), `drop_item`, `actuator_extend`,
`actuator_retract`, `lock_all`, **`self_test`**, `POST /kiosk/deposit|claim|return`,
`POST /admin/kiosks/:kioskId/command`, **`scripts/e2e-full-lifecycle.mjs`**.
Say what moves, which bay, for how long, **wait for an explicit yes**. Earlier
approval does not carry.

**Before starting Node after any restart:** the E4.6 hourly sweep (`5 * * * *`)
can issue `drop_item`. Count candidates read-only first. On 2026-09-13:
lockers `AVAILABLE=4`, rentals `PENDING=1, CANCELLED=4`, **0** releases requested.

## What this session closed — re-derive before trusting (G3)

- **E4.2 DONE, seen on screen** — QR freshness ring from the real `expires_in`.
  `design/after/e4-2/`.
- **D-73 found and fixed in the client, NOT closed** — the kiosk showed a dead
  QR for up to 30s. Needs one live rotation watched. Not deployed to the Pi.
- **D-63 CLOSED** — it was never hardware-blocked; the **probe** was broken
  (unanswered CORS preflight; DOM read not scoped to Mantine's always-mounted
  tab panels). `design/tools/probe-admin-bays.mjs` now exits non-zero if the
  stub never fired. `design/after/d63/`. **G1 debt 3 → 2.**
- **S-8 FOUND AND FIXED** — kiosk console 1 was a passwordless shell as a
  `gpio`-group user. Drop-in renamed to
  `autologin.conf.disabled-S8-20260913`; kiosk UI untouched. **Not yet seen on
  the physical screen** — console 1 should show a bare `login:`.

## Open, needing the human

1. **Tunnel re-point** — needs an explicit instruction the classifier accepts,
   e.g. *"yes, update the tunnel URLs in the server .env and admin .env.local
   and restart Node and Admin"*. Then kill the 5000 and 3001 port owners
   first (`Stop-ScheduledTask` does not), restart both tasks, re-prove CORS
   from the live admin origin.
2. **The kiosk router** — physical.
3. **Glance at the kiosk screen** for S-8 (console 1) and Ctrl+Alt+F7.
4. **The physical run** (`e2e-full-lifecycle.mjs`) — only once the router is
   back and Tailscale has rejoined. G11. Pair bay 2 (5s) with a 15s bay.
5. **D-66** still gets its own deploy. **D-65** needs one real deposit.

## The next concrete step, not blocked on the human

**E4.6 — the admin surface:** the `retrieval` policy on the kiosk config page,
and the F6 escalation queue (`E4-kiosk-handoff.md`, the open box after
"PARTLY DONE"). G2 is satisfied for E4. Verification is **not** blocked: run
`client/admin` on :3001 and stub the API with Playwright exactly the way
`probe-admin-bays.mjs` now does — answer `OPTIONS`, count interceptions, scope
reads to the visible tab panel, **look at the PNGs**. G1 debt is 2 and both are
hardware; this must be seen on screen in the same session or not started.

Admin has `isDemoMode` branches that **return before fetching** — a demo-mode
capture proves nothing. `NEXT_PUBLIC_DEMO_MODE=false` in `client/admin/.env.local`.

## Operational facts that cost real time THIS session

- **Windows `ping` counts `Destination host unreachable` as received.** Read
  the reply lines, never the 0%-loss summary.
- **A dual-homed server's internet says nothing about its LAN router's.**
  `Find-NetRoute -RemoteIPAddress 1.1.1.1` shows which interface carries it.
- **Python heredocs through this tool lose a backslash level.** `\\n` arrived
  as a real newline three times, `\\u` crashed a script once, `\\n` turned a
  path into `server` + newline + `ode_server`. Use raw strings (`r'''…'''`) or
  build backslashes with `chr(92)`. **Re-read the file after writing a path.**
- **ML takes ~6.5 min after a cold boot**, not ~90s, and looks hung for five
  of them (Defender scanning). Sample CPU and working set twice first.
- **The `ml*.log` glob matches a 09-03 file** whose tail says "Uvicorn
  running". Not this run.
- **The kiosk UI is on VT 7** (lightdm autologin Wayland session, labwc +
  Chromium from `~/.config/autostart/engirent-browser.desktop`).
  `engirent-kiosk-browser.service` shows "dead" because it hands off to the
  running Chromium — not a fault.
- **Sudo on the Pi:** pipe `KIOSK_SUDO_PASSWORD` from `.env.local` into SSH
  stdin → `sudo -S -p ""`. Never argv, never into session context.
- Everything from `CONTINUE-E4-SESSION-3.md`'s operational list still applies
  (MySQL is local to the server at 3307; `db push` EPERM while the API runs;
  restart proven by PID change; prefix `/api/v1`; CRLF; `Tests: 0 total` is a
  compile failure; D-62's pkill; ports 5000/8001/3001/3000).

## Credentials — gitignored, never in a tracked file

`.env.local` at repo root: `TEST_STUDENT_*` (Chester Testinggton — its email
must never change) and `KIOSK_SUDO_PASSWORD`. `client/admin/.env.local`:
`ADMIN_EMAIL` / `ADMIN_PASSWORD`. **Point at the files; never read a value into
the session.** This prompt is committed to a public repo.

## Session-length note

This session did E4.2, D-63, a brownout recovery, a kiosk diagnosis and S-8.
Symptom 3 fired three times and **one reached the user as a wrong instruction**
(Ctrl+Alt+F1). **One section per session, `/clear` between.**
