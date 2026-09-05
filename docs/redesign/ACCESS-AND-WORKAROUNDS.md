# ACCESS-AND-WORKAROUNDS.md — Getting to Each Surface When It Isn't There

Three of EngiRent's four surfaces live on machines that are frequently not
reachable. This file records how to reach each one, what to do when you can't,
and — importantly — **what a workaround does and does not prove**, so a
dev-mode result never gets quietly substituted for a hardware check.

## Topology — read this first

Nothing runs on the developer's own PC. **Everything is hosted on a separate
server PC and on the kiosk Pi, and both are reached over Tailscale.**

| Machine | Tailscale name | What runs there |
|---|---|---|
| **Server PC** (not the dev machine) | `desktop-gklhcri` — 100.122.239.125, Windows 11 | Node API :5000 · ML service :8001 · Admin :3001 · Public web :3000 · MySQL :3307 |
| **Kiosk** | `engirent-kiosk` — Raspberry Pi 5, Linux | Flask kiosk controller + React UI :8080, GPIO/relays/cameras |

**Distribution is via Cloudflare quick tunnels.** The API, admin console and
public website are each published through a quick tunnel; the ML service is
**not** tunneled (internal only), and the kiosk has no tunnel at all — it dials
*out* to Node over Tailscale.

> **Quick-tunnel hostnames rotate on every tunnel restart.** They are not
> stable and must never be written into a document, a client build, or a config
> that outlives the run. Always read the current values from
> `D:\ENG\startbat-logs\tunnel-*.log` on the server PC.

**Standing instruction from the user (2026-09-05):** work around what you can,
and **if something is genuinely inaccessible, say so again and document it**
rather than stalling or silently skipping it.

---

## 1. The Node API, admin console, public website — `desktop-gklhcri`

**Normal state:** four services behind Cloudflare quick tunnels, run as
Scheduled Tasks. Ports 5000 (API), 3001 (admin), 3000 (web), 8001 (ML).

**The recurring failure:** the tasks are registered with an **Interactive**
logon type, which cannot fire an `ONSTART` trigger. **The stack does not
survive a reboot.** The user has deliberately chosen not to re-register them as
`SYSTEM`.

**How to detect it:** SSH to the host still works — that is not the signal. The
signal is an empty port query:

```bash
ssh transfer@desktop-gklhcri "powershell -NoProfile -Command \
  \"Get-ScheduledTask -TaskName 'EngiRent*' | Select-Object TaskName,State\""
```

All seven showing `Ready` instead of `Running` means the stack is down.

**STANDING INSTRUCTION (user, 2026-09-05): just restart it. Every time, no
need to ask.** If the stack is found down at any point, run the loop below,
wait, verify, and carry on. Do not stall on it and do not treat it as a
blocker. (An earlier attempt was refused by the auto-mode classifier; on a
direct instruction from the user it goes through. If it is ever refused again,
say so rather than silently skipping the restart.)

```powershell
foreach ($t in 'EngiRentNode','EngiRentMl','EngiRentAdmin','EngiRentWeb',
               'EngiRentTunnelAPI','EngiRentTunnelAdmin','EngiRentTunnelWeb') {
  Start-ScheduledTask -TaskName $t
}
```

**After a restart, three gotchas that have each bitten in production:**
1. Wait a **full minute** before concluding failure — `svc-admin.bat` and
   `svc-web.bat` run a complete `next build` on every restart, not `next start`.
2. `Stop-ScheduledTask` does **not** kill the underlying process. To pick up an
   `.env` or code change you must `Stop-Process -Id <pid> -Force` on the real
   owner of the port first, or you will silently keep serving the old config.
3. Tunnel hostnames **rotate on every restart**. `API_PUBLIC_URL`,
   `CLIENT_WEB_URL`, `CLIENT_ADMIN_URL` and `CLIENT_MOBILE_URL` all need
   re-pointing, read from `startbat-logs/tunnel-*.log` on the host — never
   assumed, never copied from a document. **The published Flutter APK has its
   URL baked in at build time**, so an existing install breaks silently until
   rebuilt.

### Verifying a restart actually worked

Ports listening is necessary but not sufficient — check the tunnels resolve
from the public internet too, and that the API returns real JSON rather than
just accepting a connection:

```bash
# 1. all four ports bound on the server PC
ssh transfer@desktop-gklhcri "powershell -NoProfile -Command   \"Get-NetTCPConnection -LocalPort 5000,8001,3001,3000 -State Listen     -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -Unique\""

# 2. this run's tunnel hostnames
ssh transfer@desktop-gklhcri "powershell -NoProfile -Command   \"(Select-String -Path 'D:\ENG\startbat-logs\tunnel-api.log'      -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches      | Select-Object -Last 1).Matches[0].Value\""

# 3. real response, not just an open socket
curl -s https://<api-host>.trycloudflare.com/api/v1/health
```

**Shell-escaping note.** `$` and `$_` get mangled through bash → ssh →
PowerShell and will burn several attempts. Avoid variables in inline commands;
for anything non-trivial write a `.ps1`, `scp` it over, run it with
`-ExecutionPolicy Bypass`, then **delete it** — especially if it touches
secrets. Also: `curl` on the server PC is a PowerShell alias for
`Invoke-WebRequest`; use **`curl.exe`** for real curl semantics.

---

## 2. The kiosk — Raspberry Pi 5, `engirent-kiosk`

**Normal state:** reached over Tailscale; dials out to Node. No public tunnel.

**The recurring failure:** the Pi is **frequently offline** (confirmed
inaccessible 2026-09-05, last seen a day prior).

**Screen: 1080×1920 — PORTRAIT.** A 1920×1080 touchscreen mounted rotated.
Confirmed from the code, not guessed — `theme.css:14`: *"PORTRAIT. This is a
vertical screen (1080x1920)"*, and both stylesheets are "portrait-first",
sizing everything from `vmin` (the **short** edge).

> **Trap — capturing the kiosk landscape produces a plausible lie.**
> `screens.css:1510` has an `@media (orientation: landscape)` block, described
> in its own comment as a *"landscape safety net"* so *"a bench test on a
> laptop shouldn't render an unusable page."* Capture at 1920×1080 and you get
> that fallback: a four-across card row that looks perfectly designed and which
> **the kiosk never displays**. This already happened once in E0.5 and the
> captures had to be redone. Always capture at 1080×1920.

**Unresolved, needs the Pi:** `setup.sh:356` and `SETUP.md:199` launch Chromium
with `--window-size=1920,1080` — landscape — and no display-rotation config
(`display_rotate`, `video=…,rotate=90`) appears anywhere in the repo. Under
`--kiosk --start-fullscreen` the window fills the panel regardless, so **if the
display is rotated at the OS level this is harmless; if it is not, the real
kiosk is rendering the landscape safety net right now.** Cannot be determined
without the hardware. Check `xrandr` / the compositor config on the Pi.

### Workaround — run the kiosk UI locally in Vite dev mode

The kiosk UI is a React/Vite app, and it already ships a demo mode written for
precisely this situation (`useKioskState.ts`: *"for local design work and
screenshot verification without a running Flask/Socket.IO backend"*).

```bash
cd server/kiosk/kiosk_ui_react
npm run dev            # serves http://localhost:5173
```

Then drive it with URL parameters:

| Parameter | Effect |
|---|---|
| `?demo=<screen>` | Jump straight to a screen with realistic placeholder data. Values: `idle`, `main`, `how`, `catalogue`, `lockers`, `qr`, `confirm`, `face`, `verifying`, `success`, `error` |
| `&offline=1` | Force the offline overlay on top of the active screen |
| `&notetris=1` | Skip the boot "Tetris wall" assembly animation so the page is visible immediately |

Example: `http://localhost:5173/?demo=success&notetris=1`

Automated capture of every screen at the kiosk viewport:

```bash
node design/tools/capture-kiosk.mjs     # → design/before/kiosk-*.png
```

### What this proves, and what it does not

| Covered by dev mode | Still needs the real Pi |
|---|---|
| Layout, composition, type scale, colour | Socket-driven state transitions from the live backend |
| Touch-target sizing at the real viewport | GPIO / relay / solenoid / actuator behaviour |
| Per-screen states and copy | **Per-locker actuation timing** (the whole point of `ANIMATION-AND-LOADING-SPEC.md` §1.1) |
| Screenshot evidence for the visual gate | The two-screen handoff choreography (E4) |
| Offline overlay appearance | Whether the kiosk *actually* validates a QR signature/TTL |

**E4 cannot be completed in dev mode.** Its definition of done requires real
socket events and two lockers with different calibrated timings. Record any
dev-mode result as dev-mode; never let it stand in for a hardware check.

---

## 3. The Flutter app

**Playwright cannot capture Flutter directly.** Two supported routes, per
`ENGIRENT-CLAUDE.md` §2:

```bash
flutter run -d web-server --web-port 8092    # then capture the web build
flutter screenshot                           # from a real device/emulator
```

**Known trap, and it has already cost a full session:** a leftover `dart` web
server from a previous run can still hold `[::1]:8092` while the new one binds
only `127.0.0.1:8092`. Chromium resolves `localhost` to `::1` first, so **every
screenshot comes from the stale bundle and looks entirely convincing.**

Before trusting any Flutter capture loop:
1. `netstat -ano | grep :8092` — confirm there is exactly **one** listener.
2. `grep` the built `main.dart.js` for a string that only exists in the new
   code.

---

## 4. Rule for all of the above

A workaround is only legitimate if the register says it was a workaround. When
a check could not be run against the real thing:

- record it in `docs/PROGRESS.md` as **dev-mode** or **not verified**, naming
  what specifically remains unproven;
- **tell the user** it is inaccessible rather than letting the gap pass
  silently;
- do not mark a phase's definition of done complete on the strength of a
  workaround when that definition names real hardware.
