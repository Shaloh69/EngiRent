# CONTINUE-E4-SESSION-1.md — paste into a fresh Claude Code session

> Supersedes `CONTINUE-E3-SESSION-2.md` (bannered as superseded).
> Written 2026-09-11 at the end of a very long session. **E0, E1, E2 are
> closed with named gaps. E3 is 14/16 — both remainders are listed below.
> E4 is OPEN: its G2 table exists and A-3 has been measured.**

---

**You are resuming the EngiRent redesign track in E4.**

**First: `git branch --show-current` must say `e0-e1-audit-tests-and-evidence`.**
**`main` has none of this work and you must NOT push** — the repo is public and
pushing would republish S-3/S-5 history and a real student's photos from
`design/before/`. If you are on `main`, stop and tell the user.

Read, in this order, and **only** these:

1. `CLAUDE.md`
2. `docs/redesign/ENGIRENT-CLAUDE.md`
3. `docs/PROGRESS.md` — in full. Start with the CONTEXT DEGRADATION LOG, then
   the **2026-09-11 E4.5a G5 entry**, then **A-3 — MEASURED** and **E4.5a —
   first findings**.
4. `docs/redesign/CLAUDE-CODE-PLAYBOOK.md` §2c-2d — **there are now TEN gates,
   not eight. G9 and G10 are new and both came from the user.**
5. `memory.md` — the **2026-09-11** entries (blackout restart, the port map,
   D-62's pkill trap).

Then `docs/redesign/phases/E4-kiosk-handoff.md`.

**Open every response with the status line from `PROGRESS.md`.**
**End every session by showing `npm run report` (G10).**

---

## The habit that matters most, restated from this session's evidence

**G8 — name the distinguishing signal in writing BEFORE you look.** It caught
something real every single time it was applied.

**And its sharper form, which fired five times in one session and is now the
named pattern:**

> **System state is a HYPOTHESIS about the code, never a conclusion about it.**

Every instance came from reading a device listing / `pgrep` / `diff` / `fuser`
and inferring what the code does. Real examples, all wrong, all caught by
opening the code:

- `diff` said **711 lines added and 22 GPIO calls** on a pure data relay — it
  was **CRLF vs LF**. Normalised: 31 added, 0 GPIO calls. Taken at face value
  it reads as *"I just shipped GPIO code to a live locker bank."*
- `camera_index 0,1,2,3` against capture nodes at `video0,2,4,6` "proved"
  lockers 2 and 4 had dead cameras. `USB_DEVICE_MAP` resolves by **stable
  by-path**; the scramble is the design working.
- `pgrep -f "chromium.*--app=…"` over SSH **matched my own SSH command line**
  and reported 2 browsers where there were 0.
- `systemctl is-active` said `active` after a **failed** `sudo` restart — only
  the unchanged **PID** revealed nothing had restarted.
- A panel crop measured "1.19:1, orange on orange" — I had measured a region
  **without looking at the image**, which was showing the Pi desktop.

---

## Where E4 actually is

**E4 starts further along than its box count suggests** — E3 landed several
beats. The G2 table in `PROGRESS.md` has the full per-beat state. Summary:

- **Done already:** the Verifying beat (phone indeterminate + the **120s
  countdown driven by the server's absolute `expiresAt`** + attempt N of 4);
  `WorkingScreen` consuming `door_open`/`dropping`/`capturing`; the Failure
  beat (seen live during a blackout).
- **Three real gaps the phase file did not spell out:** the kiosk never names
  **who** it is waiting for; QR freshness is text with **no ring/bar**; the
  phone has **no live framing feedback** (the file admits this itself).

### E4.5 — added by the user, and the honest state of it

The ask was: *prove the media pipeline works end to end*, and *auto-approve
above ~90% confidence to cut human approvals*.

**A-3 has now been measured and it changes the plan. Read this before
promising anything:**

| | |
|---|---|
| `Verification` rows, all time | **2** |
| Their confidence scores | **0 and 0** |
| Rentals that ever reached DEPOSITED/ACTIVE/COMPLETED | **0** |
| Rentals carrying a `verificationScore` | **0** |

**So the ≥90% bar cannot be set, and the blocker is data, not process.** Any
number would be invented. The literature framing is in the phase file: this is
*selective classification with abstention*, and the principled method is
**conformal calibration to a target error rate** — which needs a score
distribution that does not exist yet.

**D-65 blocks it even once data exists.** `mlVerificationService` already
distinguishes a fetch failure from a low score (`unavailable: true` +
`unavailableReason`, with a unit test) — and then **throws the flag away**: it
is read nowhere and persisted nowhere, and `Verification` has no field for it.
So *"no evidence"* and *"evidence of no match"* are the **same database row**.
That is exactly why A-3's two zeros cannot be interpreted.

**Fix shape, NOT applied — it is a migration against the live DB, the user's
call:** add `unavailable Boolean @default(false)` and `unavailableReason
String?` to `Verification`, write them from the result object that already
carries them, and exclude those rows from any calibration set.

**Cameras are HEALTHY** — verified without driving anything. Four cameras, one
per locker, all four by-path devices resolving to the four capture nodes
(L1→video4, L2→video6, L3→video2, L4→video0). **D-54's note saying "3 cameras
where there are really 5" is wrong in both numbers.**

---

## What needs the human — hand these over, do not wait on them silently

1. **Real deposits.** Every remaining E4 item needs doors driven and items
   physically placed: E4.4's sync test, E4.5a's full trace, and A-3's
   distribution. **Pair locker 2 (5s door) with any other (15s)** — any other
   pairing passes a sync test that proves nothing.
2. **The D-65 migration** (above).
3. **G1 debt 1:** D-63's admin UI. The endpoint is deployed and verified live
   (proven *unfiltered* by flipping a bay to OCCUPIED and one to
   non-operational). The card was seen rendering **real** state, but its
   `OCCUPIED` / non-operational / **"occupied with no rental — the stuck case"**
   branches have **not** been seen. Playwright interception did not fire (the
   page reached the real API), and localhost is CORS-rejected because the
   allowlist is built from `CLIENT_ADMIN_URL`.
4. **C: was at 98%** (14 GB free). It crashed two emulators and failed one APK
   build that then succeeded unchanged.

## E3's two remainders

- **Locker representation** — the kiosk half is done (D-53 closed on live
  hardware). App and admin are not on one shared model. **D-64**: the app says
  *"All kiosk lockers are currently occupied"* when they may be out of service.
- **Loading primitives** — `socket_client.py` must send `duration_seconds` so
  the kiosk's determinate bar has a real duration (one optional kwarg on the
  existing `_set_ui` calls). Until then it renders **indeterminate, never a
  guessed bar**. Verifying it needs a real door cycle.

---

## Operational traps learned the hard way on 2026-09-11

- **D-62: `pkill -f "chromium.*--app=http://localhost:8080"` KILLS THE
  SUPERVISOR TOO** — the autostart Exec is a `bash -c` whose body contains that
  literal string. `memory.md`'s "the supervisor relaunches in ~25s" is wrong;
  it is dead. **A public kiosk sat on the Raspberry Pi desktop.** Use
  `pkill -f "^/usr/lib/chromium/chromium"`, or restart the service.
- **Relaunching chromium over SSH** needs `XDG_SESSION_TYPE=wayland` **and**
  `--ozone-platform=wayland`; the autostart's `-hint=auto` resolves to X11
  outside the desktop session and exits with *"Missing X server"*.
- **Real port map** — Node **5000**, ML **8001** (not 5001), admin **3001**,
  web **3000**. I probed the wrong ports and nearly called two healthy
  services dead.
- **Kiosk SSH needs a Tailscale check**: each attempt mints a **new** URL and
  the connection **waits** while the user authorises it. Launch the attempt
  with a long timeout, hand over that URL, then poll — a URL from a
  timed-out attempt is already dead.
- **Kiosk rotation does NOT survive reboot (D-59)** despite the autostart
  entry. Check `wlr-randr` (never `xrandr` — XWayland) before trusting any
  capture; landscape silently renders a "safety net" layout the kiosk never
  shows.
- **Tunnels rotate every restart** and the API's three `CLIENT_*_URL` values
  go stale. The check that proves the env reloaded is an **OPTIONS preflight
  from the new admin origin echoing that origin**.

## Tooling that now exists — use it, don't rebuild it

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
`KIOSK_SUDO_PASSWORD`. `client/admin/.env.local`: `ADMIN_EMAIL` /
`ADMIN_PASSWORD`.

**Pass secrets over STDIN, never argv.** A `pgrep` on the Pi printed a full
remote command line this session — argv is world-readable there.

## Session-length note

This session ran very long. **One E4 section per session, `/clear` between.**
