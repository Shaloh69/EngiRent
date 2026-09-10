# CONTINUE-E3-SESSION-2.md — paste into a fresh Claude Code session

> Supersedes `CONTINUE-E3-SESSION-1.md` (which is bannered as superseded).
> Written 2026-09-10 at the end of an 18-commit session. **E0, E1, E2 and
> E3.1 are COMPLETE. E3.2 is ~80% done.**

---

**You are resuming the EngiRent redesign track inside E3, section E3.2.**

**First: `git branch --show-current` must say `e0-e1-audit-tests-and-evidence`.**
**`main` has none of this work and you must NOT push** — the repo is public and
pushing would republish S-3/S-5 history and a real student's photos from
`design/before/`. If you are on `main`, stop and tell the user.

Read, in this order, and **only** these:

1. `CLAUDE.md`
2. `docs/redesign/ENGIRENT-CLAUDE.md`
3. `docs/PROGRESS.md` — in full. Start with its CONTEXT DEGRADATION LOG, and
   read the **2026-09-10 session-end G5 entry** before anything else.
4. `docs/redesign/CLAUDE-CODE-PLAYBOOK.md` §2c-2d — the incident log and the
   gates. **There are now EIGHT gates, not seven. G8 is new and is the most
   load-bearing thing added this session.**
5. `memory.md` — the 2026-09-10 entries specifically (kiosk deployment
   procedure, test account, stack restart).

Open every response with the status line from `PROGRESS.md`.

---

## The one habit that matters most here

**G8 — name the distinguishing signal in writing BEFORE you look.** The
recurring failure on this track is not forgetting things, it is accepting
evidence that is *adjacent* to proof. Recent real examples, all caught only on
a second look:

- `exit code 0` from a pipeline whose `tail` succeeded while the build failed
- `ROTATE_EXIT=1` that was a `grep`'s status, not `chpasswd`'s
- an app that launched and did not crash — while `SentryFlutter.init` was never called
- `String(faceEncoding).length === 15`, which is `[object Object]`

**And its sibling, which fired four times: when a tool disagrees with the
artifact, suspect the tool first.** `scrot` returns a black frame on this Pi
(it is Wayland — use `grim`); `xrandr` reports XWayland, not the compositor
(use `wlr-randr`); a regex for `statusRole` "proved" Flutter had no status map
when Dart names it `kStatusRole`; an import guard was fooled by a comment
mentioning the module name.

---

## Where E3.2 actually is

**Done and verified on screen:**
- Toast restyled onto tokens (behaviour untouched); the two auth screens that
  were bypassing `AppToast` with raw SnackBars now use it — `showSnackBar` is 0
  across `lib/`.
- **D-50** connection indicator: "Connecting…" was warning-amber, now `review`.
- **D-37** executed (option b): the four `admin:kiosk_*` socket events are
  gone; SSE still serves the hardware pages; the three `adminRoom` tests were
  repointed at queue events, not deleted.
- **D-38** swept across **all 12 admin pages** — the register said one page. A
  shared primitive lives at `client/admin/src/components/ui/UnknownValue.tsx`.
- Status chip: **×2 surfaces, not ×4** (kiosk has its own vocabulary, website
  has none). All 26 states agree across `tokens.json`/admin/Flutter, and the
  drift guard (`node design/tokens/build.mjs --check`) was proven by injecting
  `PENDING: review → warning` and watching it report STALE.

**REMAINING IN E3.2 — one item, plus a deploy that is blocked:**

1. **The three loading primitives** (determinate / staged / indeterminate).
   Not started. **Survey the repo before building** — the "×4 surfaces"
   assumption in the E3.2 row has already been wrong once.
2. ~~**D-53's Node emitter.**~~ **WRITTEN 2026-09-11 (`6a9d07b`).** Both halves
   of D-53 are now in the repo. **Neither is deployed and nothing has been seen
   on screen — the Pi went offline again.** See the updated section below.

---

## D-53 is half-shipped — finish this first

**Ruled by the user: the kiosk should receive `LockerStatus`.**

*Why:* `_ui_state["lockers"][id][door]` is `"unlocked"` only while a door is
physically standing open, for the seconds of a handover. The UI counted bays
with no open door and told students *"N doors are empty and ready for a
drop-off"* — ~4 of 4 essentially always, whatever the bays held.

**Shipped (committed, NOT deployed):**
- `server/kiosk/services/socket_client.py` — a `kiosk:occupancy` handler
  storing per-bay status in `_ui_state["occupancy"]`. **Pure data relay: no
  solenoid/actuator/camera call.** That boundary is deliberate — `CLAUDE.md`
  forbids UI work reaching GPIO.
- Kiosk UI: availability now derives from `LockerStatus`; **absent renders as
  UNKNOWN**, never as free.

**Node half — WRITTEN 2026-09-11, `6a9d07b`, NOT DEPLOYED.**
`server/node_server/src/services/lockerOccupancyService.ts` emits
`kiosk:occupancy` to `kiosk:${kioskId}` on `kiosk:register` and at all 10
`locker.update` sites. `isOperational: false` folds to `OUT_OF_SERVICE`; the
service never throws; a kiosk id with no `Locker` rows warns instead of
emitting an empty map. 7 tests, mutation-checked three ways; 124/124 Jest;
`tsc` clean. Full detail and the reasoning: `docs/PROGRESS.md` → D-53.

**Still to do — THE DEPLOY, AND IT IS BLOCKED ON HARDWARE:**
- **The Pi is offline** (`tailscale status` → `engirent-kiosk … offline`; ssh
  to the name and to `100.78.42.89` both time out). **Unblock is physical:
  power it on.**
- **Then deploy both halves together**, so the panel goes from "unknown" to
  real status in one step instead of shipping a half-state to a live kiosk.
  The kiosk half is **two** copies, not one: the built UI into
  `kiosk_ui_react/dist` **and** `server/kiosk/services/socket_client.py` (the
  relay handler is a Python file and does **not** travel with `dist/`).
- **Verify on the panel, not in a log.** The distinguishing signal: with four
  `AVAILABLE` bays the Locker screen must read **"4 of 4 — Every bay is empty
  and ready for a drop-off"**; flip one row to `OCCUPIED` in the DB and it must
  read **3 of 4** with that bay's card showing **"In use"**. If it reads
  **"— / Waiting for the locker controller to report bay status"**, the relay
  did not land or the room name missed — that is the failure this whole
  change is shaped around, and it is invisible from the server side.

**D-54 is open and needs a ruling** (`docs/PROGRESS.md`): `seed.ts`'s
`seedKioskConfig` still writes an obsolete hardware schema — trapdoor pins,
PWM actuator pins, wrong GPIO numbers, 3 cameras of 5, 5s/3s against the real
calibrated 15s/22/21/17/23s. It is inert only because its key is still
`kiosk-1`. **Do not "fix" that constant without reading D-54 first.**

---

## Deploying (this bit is easy to get wrong)

**Kiosk UI — no GPIO risk.** `main.py` serves the built UI from
`server/kiosk/kiosk_ui_react/dist`, so deployment is a **file copy into
`dist/`** and nothing else:

```
npm run build
tar -czf /tmp/d.tgz -C dist .          # POSIX path — "C:/..." makes tar think it is a host
scp /tmp/d.tgz engirent@engirent-kiosk:/tmp/
ssh … 'cd ~/Desktop/EngiRent/server/kiosk/kiosk_ui_react &&
        cp -r dist dist.bak-<date> && rm -rf dist && mkdir dist &&
        tar -xzf /tmp/d.tgz -C dist'
ssh … 'pkill -f "chromium.*--app=http://localhost:8080"'   # supervisor relaunches in ~25s
```

**Node API.** `svc-node.bat` runs `npm run build && npm start`, so copying the
`.ts` is enough — but **diff the remote file first**, the checkout is diverged
by design. Restart needs `Stop-Process` on the real owner of port 5000 *before*
`Start-ScheduledTask`; a `Stop/Start-ScheduledTask` cycle silently keeps the
old process and the old build.

**The stack is usually down** (Interactive-logon tasks do not survive reboot).
Restart it yourself — standing instruction. Verify with *real responses*, not
open ports.

---

## Open, needing the user

- **D-53's Node emitter + deploy** (above).
- **B-2 partially lifted** — the Pi is up. E4, E0.3's three wait measurements,
  and re-measuring the kiosk contrast against the *redesigned* UI are now
  possible. The physical contrast check passed (6.64:1–17.70:1) but **against
  the pre-redesign build**; the Pi runs `main@1546cd6`.
- **Two kiosk items**: a duplicate browser supervisor loop (harmless while the
  `pgrep` guard matches; resolves on reboot), and `defaultValue: true` on
  `USE_DEMO_MODE` (**D-51** — every debug build accepts any credentials when
  offline; correctly gated on `kDebugMode`, so not shippable, but it makes
  offline auth testing silently meaningless).

## Credentials — all gitignored, never in a tracked file

`.env.local` at repo root: `TEST_STUDENT_*` (Chester Testinggton, the
face-verification account — **its email must never change, five e2e suites
match it literally**) and `KIOSK_SUDO_PASSWORD`.
`client/admin/.env.local`: `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

**S-5's lesson, which is why they live there:** a regex sweep cannot find a
credential that does not look like one — the old kiosk password was six digits
mid-sentence in prose. The fix is never writing values into prose, not a better
regex.

## Session-length note

This session ran very long (18 commits). Prefer one section per session and
`/clear` between.
