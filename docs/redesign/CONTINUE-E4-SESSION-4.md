# CONTINUE-E4-SESSION-4.md — paste into a fresh Claude Code session

> Supersedes `CONTINUE-E4-SESSION-3.md` (bannered as superseded).
> **Revised 2026-09-13 at 23:40**, after a brownout recovery, four new defects
> and the first E4 work ever seen on the physical kiosk. The earlier version of
> this file (written the same afternoon) was stale within hours.

---

**You are resuming the EngiRent redesign track.**

**First: `git branch --show-current` must say `e0-e1-audit-tests-and-evidence`.**
`main` tracks it and everything below is **pushed**. It is a **public** repo:
run G6 before the first commit, every session.

Read, in this order, and **only** these:

1. `CLAUDE.md` — G11 is the first hard rule.
2. `docs/redesign/ENGIRENT-CLAUDE.md`
3. `docs/PROGRESS.md` — the STATUS LINE, the CONTEXT DEGRADATION LOG (**both
   2026-09-13 entries**), then **D-73 through D-77** and **S-8, S-9**.
4. `docs/redesign/CLAUDE-CODE-PLAYBOOK.md` §2c-2d — **G1-G11.**
5. `memory.md` — the **2026-09-13 SECOND BROWNOUT** entry, in full.

Then `docs/redesign/phases/E4-kiosk-handoff.md`.

**Open every response with the status line. End every session with
`npm run report` (G10).**

---

## The state of the estate, 2026-09-13 23:40 — RE-DERIVE IT ANYWAY (G3)

Both machines are healthy for the first time all day. A liveness fact here
expires in minutes; check before quoting.

| | State at hand-off | How to check |
|---|---|---|
| **Kiosk Pi** | on **`GFiber_2.4_Coverage_e3280`**, internet OK, **Tailscale up**, clock synced, controller connected to the API, all 8 doors locked | `ssh engirent@engirent-kiosk` |
| **Kiosk screen** | idle attract loop; **E4.2's ring is deployed and was photographed on it** | `grim`, below |
| **Server** | Node, ML, admin, web all up; **tunnels re-pointed and CORS proven** | PID on 5000 — never quote an old one |
| **Tailscale SSH** | now in **check mode**: a first connection prints a login URL the user must open | expect it, ask the user |

**The kiosk moved networks.** It is no longer at `192.168.1.65`; it is on
`192.168.254.x`, the same network the server reaches the internet through. The
LAN-jump trick in the ops scripts still hardcodes the old address — harmless,
it falls back to Tailscale first, but fix it if the Pi drops off the tailnet.

## Two ops scripts, allowed by exact-match permission rules

Narrow on purpose: a wildcard `ssh engirent@engirent-kiosk *` rule would also
allow opening a door (G11).

```
bash scripts/ops/kiosk-restart-controller.sh    # restarts ONE service; refuses unless idle + all doors locked
bash scripts/ops/server-repoint-tunnels.sh      # sweep check, re-point with backups, restart Node + admin
bash scripts/ops/kiosk-start-wifi-setup.sh      # Wi-Fi setup mode (drops remote access — see below)
```

**`.claude/settings.local.json` is tracked in this PUBLIC repo and still holds
`Bash(ssh -o ConnectTimeout=15 engirent@engirent-kiosk *)`** — a standing G11
hole the user has been told about twice. Raise it once; do not edit it unasked.

## Seeing the kiosk screen without a photo — use this, it is new

```
ssh engirent@engirent-kiosk 'WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000 grim /tmp/s.png'
scp engirent@engirent-kiosk:/tmp/s.png .
```

The UI sits on **VT 7** (lightdm autologin → labwc → Chromium). To reach the QR
screen without touching the kiosk:
`curl -X POST -d '{"status":"item_retry"}' http://localhost:8080/api/ui` — UI
only, no GPIO — then restore `{"status":"idle"}`. **`IDLE_MS` is 30s**, so the
main screen returns to the attract loop before a 90s QR token can expire.

## What closed today, and what did not

**Closed and seen:** E4.2 (ring + live countdown **on the physical screen**,
`design/after/e4-2/kiosk-live-ring.png`), D-63 (the probe was broken, not the
component), D-74 (verified **both** directions on hardware), D-75, S-8, S-9.

**Fixed in code, NOT proven on hardware:**
- **D-73** — dead-QR window. Deployed. Severity refined: `IDLE_MS = 30s` means
  it only bites someone keeping the screen awake past 90s. To verify: touch the
  screen every ~20s and watch the code change with the caption never at 0.
- **D-76** — the setup portal could never run as the service user (bind :80
  denied; NM `wifi.share.protected` = no). Worked around with a root unit.
- **D-77** — the hotspot was never at 192.168.4.1 (nmcli names the profile
  `Hotspot`, not the SSID), ran **no DHCP** (`method manual`), and could not
  tear itself down — it stranded the kiosk until a power-cycle. Rewritten in
  `provisioning/hotspot.py`. A later run rebooted the Pi (a successful save
  does), so **the captive-portal auto-open has still never been seen working**.

**E4.6 remains deployed and completely unexercised. No actuator has moved, no
bottom door has opened.**

## Open, needing the human

1. **The physical run** — `node scripts/e2e-full-lifecycle.mjs <face.jpg>`.
   **G11: say what moves, which bay, how long, and wait for an explicit yes.**
   Pair **bay 2 (5s)** with any other (15s). It collapses E4.4/E4.5, A-3's first
   real row, D-65's write path and E4.6 at once. The kiosk is finally online for
   it.
2. **The user's ruling, not yet built:** *"If a single Wi-Fi does not have any
   internet in many attempts of checking, it will automatically disconnect and
   start that."* Overrides D-74's auto-AP-off default. Must keep: the existing
   grace (15 checks), a `safe_to_disrupt` gate wired to `/api/state` (idle, no
   active locker, all 8 doors locked — currently `None`, which the policy treats
   as unsafe), and the give-up timer. **Needs one narrow sudoers line** allowing
   `systemctl start engirent-wifi-setup.service` — a Pi system change, **ask first**.
3. **D-66** still gets its own deploy. **D-65** needs one real deposit.
4. **Did the setup page open by itself on the Android?** Only the user knows.

## The next unblocked work

`npm run report`: **85/193 (44%)**, and only **6** boxes are hardware-blocked.
E6 has **31**, E5 **19**, E7 **17**, E4 **28 non-blocked**. The 69 screens are
still at **0 PASS** — that is where the distance is.

**E4.6's admin surface** (retrieval policy on the kiosk config page + the F6
escalation queue) is the cleanest next chunk: G2 is satisfied for E4, and it is
verifiable with the Playwright stub pattern that `probe-admin-bays.mjs` now
uses — answer `OPTIONS`, count interceptions, scope reads to the visible tab
panel, **and look at the PNGs**. Admin has `isDemoMode` branches that **return
before fetching**, so a demo capture proves nothing.

## Hard-won operational facts

- **An ignored return code is the defect.** Every bug today was a silently
  discarded failure: `capture_output=True` never read (D-77), a permission that
  answers "no" to a service (D-76), `Start-ScheduledTask` ignored while the old
  instance still ran (admin stayed down). Two of them logged something
  reassuring and false.
- **Windows `ping` counts "Destination host unreachable" as received.** Read
  the reply lines, never the 0%-loss summary.
- **A dual-homed server's internet says nothing about its LAN router's.**
- **This PC also hosts EcoCharge** (ports 30010-30014). A healthy
  node/python/cloudflared list is not evidence EngiRent is up.
- **Python heredocs through the Bash tool lose a backslash level** — `\n` and
  `\u` both bit, one corrupting a committed path. Use `r'''…'''` or `chr(92)`,
  and re-read the file after writing a path.
- **The Pi's journal is volatile and `/tmp` is wiped** — a provisioning save
  reboots the Pi and destroyed a whole test report. Reports now go to
  `/home/engirent/`.
- **ML takes ~6.5 min after a cold boot**, not 90s, and looks hung (Defender).
- Everything in `CONTINUE-E4-SESSION-3.md`'s operational list still applies
  (MySQL local at 3307; `db push` EPERM while the API runs; restart proven by
  PID change; prefix `/api/v1`; CRLF in `src/index.ts`; `Tests: 0 total` is a
  compile failure; D-62's pkill pattern; ports 5000/8001/3001/3000).

## Credentials — gitignored, never in a tracked file

`.env.local` at repo root: `TEST_STUDENT_*` (Chester Testinggton — its email
must never change) and `KIOSK_SUDO_PASSWORD`. `client/admin/.env.local`:
`ADMIN_EMAIL` / `ADMIN_PASSWORD`. The Pi's `server/kiosk/.env` holds
`AP_PASSWORD`. **Point at the files; never read a value into the session.**
This prompt is committed to a public repo.

## Session-length note

The session this replaces ran from E4.2 through a brownout, a stranded kiosk
and four defects. **One section per session, `/clear` between.**
