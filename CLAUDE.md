# CLAUDE.md — EngiRent

Peer-to-peer equipment rental for engineering students at UCLM, where the
handoff between two students is mediated by an **unattended 4-locker bank**
driven by a Raspberry Pi 5 instead of the two of them meeting in person.

Four surfaces: Flutter app (`client/flutter_app`), admin console
(`client/admin`, Next.js 15 + Mantine 7), kiosk UI
(`server/kiosk/kiosk_ui_react`, React/Vite on the Pi), public website
(`client/web`, Next.js). Backed by a Node/Express API
(`server/node_server`) and a Python ML verification service
(`server/python_server/services/ml`).

## Read these, in this order, at the start of every session

1. **`memory.md`** (repo root) — the running engineering log. More current
   than anything in `docs/audit/`. Read it in full.
2. **`Implemented.md`** (repo root) — the 2026-09-04 implementation audit.
   Current, but written from a code read on the day of a major architecture
   change; verify before trusting a specific claim.
3. **`docs/redesign/ENGIRENT-CLAUDE.md`** — rules for the active redesign
   track (scope boundary, the Playwright gate, redo capability).
4. **`docs/PROGRESS.md`** — live state and the three registers. Resume from
   its "next concrete step."

Then the current phase file in `docs/redesign/phases/`.

**Don't re-read the whole redesign package every session.** Those four, then
the phase file. Re-reading everything is itself a context-filling mistake.

## Hard rules

- **The repo wins over the docs.** These documents were written from an audit
  and a defect report, not from running the product. Where they conflict with
  the code, flag it, fix the doc, then proceed — don't work around it
  silently.
- **Never change `server/kiosk/kiosk_config.json`'s per-locker timings.**
  They are hand-calibrated against real hardware and verified twice. If an
  animation and a timing value disagree, the hardware is right.
- **UI work does not reach the GPIO layer.** The kiosk drives 8 solenoids and
  4 linear actuators through active-LOW relays. Don't touch the autostart
  supervisor script as part of UI work — it has bitten twice in production.
- **Do not redesign the face-verification trust architecture**
  (`Implemented.md` §6): the kiosk validates the scanned QR itself — it
  accepts only the one token currently live in its own process, inside the
  90s TTL, single-use (**not** a signature recomputation — corrected
  2026-09-06 in E1; see `server/kiosk/tests/test_qr_token.py`),
  `resolveFaceSubject` derives identity from rental status not client input,
  the server-side session store is the trust boundary, Node calls the ML
  service so the key never reaches a client, and verification fails closed.
  Design around it.
- **Server-side stays authoritative.** Client-side role gating is a UX fix and
  must never be described as a security boundary.
- **Security findings get fixed immediately and reported**, not filed as
  backlog.
- **Default to continuing, not reporting.** `docs/PROGRESS.md` is the running
  record; put findings there and keep working. Interrupt only when the human
  can *act* on it — blocked, a ruling needed, a security finding, context
  filling, an irreversible action on a live system, a correction to something
  already reported, or a phase boundary. Criteria:
  `docs/redesign/ENDGOAL-AND-TRACKING.md` §2, "When to surface something". The
  bar is **"does this threaten the implementation as a whole?"** — not "is this
  interesting". A defect found, fixed, tested and recorded is finished work and
  belongs in the register, silently.
- **A green test is not a fix.** Verify on screen before recording anything as
  fixed — D-1 passed six unit tests while still visibly broken.
- **Predated docs get moved and bannered, never deleted** (`REPO-HYGIENE.md`).
- **"Typecheck clean, tests green" is necessary and nowhere near sufficient.**
  This project has been bitten repeatedly by code that compiled, passed, and
  was broken on screen. Open the thing and look at it.

## Testing reality

There is almost no safety net. Admin console: **zero** tests, no tooling.
Flutter: **2** unit tests across 23 screens, neither widget nor integration.
ML service: 5 tests, all on the API-key gate. Node: 6 Jest files with a fully
mocked Prisma client, plus 10 real-HTTP `server/node_server/scripts/e2e-*.mjs`
suites that only run when someone remembers. Treat any claim of "done" that
rests on a clean build as unverified.

## Deployment

**Connecting: `ssh transfer@desktop-gklhcri`** (Tailscale MagicDNS; or
`transfer@100.122.239.125`). Key-based, no password, plain `ssh` — there is no
`tailscale ssh` step. **The remote shell is PowerShell, not cmd**, so `dir /b`
fails, `&`/`&&` are reserved, and `$`/`$_` get eaten crossing bash → ssh →
PowerShell. For Node/Prisma one-liners use PowerShell's stop-parsing token —
`node --% -e "…"` — and write the JS with single quotes only. Full detail,
including which command *shapes* the auto-mode classifier refuses (it does
**not** block SSH itself — verify with `ssh … 'hostname'` before concluding
otherwise): `docs/redesign/ACCESS-AND-WORKAROUNDS.md` §1a-1b.

Services run on `desktop-gklhcri` (Tailscale) as Scheduled Tasks with an
**Interactive** logon type, so they do not survive a reboot — see `memory.md`'s
runbook for the restart procedure and its three known gotchas. Cloudflare quick
tunnels rotate hostname on every restart, which silently breaks any client with
a baked-in URL (the Flutter app specifically). The server's working tree
(`D:\ENG\EngiRent`) is a **diverged checkout**; deployment there is a manual
file copy, not a `git pull`. This repository is the source of truth for code.
**A change committed here is not deployed** — `docs/PROGRESS.md` D-32 is a live
example of a ruling recorded as "executed" that never reached the server.
