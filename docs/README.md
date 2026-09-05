# EngiRent Hub — Documentation Index

Every non-code document for the project, organized by why each one is kept.

**If you're looking for "what does the system actually do," start with
[`Implemented.md`](../Implemented.md) at the repo root** — the 2026-09-04
implementation audit. For *why* something is the way it is, and what happened
across sessions, read [`memory.md`](../memory.md), the running engineering log.

| Folder / file | Contents | Read this when... |
|---|---|---|
| [`../Implemented.md`](../Implemented.md) | The current implementation audit (2026-09-04). Covers all six surfaces. | You need to know what the code actually does today. |
| [`../memory.md`](../memory.md) | The running engineering log — decisions, discoveries, runbooks, session history. More current than any audit. | You need the *why*, a runbook, or what a past session already ruled out. |
| [`PROGRESS.md`](PROGRESS.md) | Live state of the active redesign track, plus its three registers (screens, defects, endpoints). | You're resuming work on the redesign track. |
| [`redesign/`](redesign/) | The active audit / defect-fix / redesign package, including `phases/E0`–`E7`. | You're starting or resuming a redesign phase. |
| [`redesign/ACCESS-AND-WORKAROUNDS.md`](redesign/ACCESS-AND-WORKAROUNDS.md) | How to reach the API host, the kiosk Pi and the Flutter app when they're offline — plus what each workaround does **not** prove. | A surface you need is unreachable. |
| [`planning/`](planning/) | The revamp planning sequence: `01-audit-prompt.md` → `02-design-mandate.md` → `03-revamp-master.md` → `04-continue-design-redo.md`, plus the two feature checklists. | You need the design mandate or a build checklist. |
| [`reference/`](reference/) | Background detail: the ML pipeline writeup, the item-category survey, and an independent repo analysis. | You need depth beyond the audit — e.g. the exact math behind a verification stage. |
| [`predated/`](predated/) | **Superseded documentation**, moved and bannered. Includes both prior audits and the original kickoff prompt. | You're writing the thesis narrative, or tracing why an old claim doesn't match reality. **Never** to answer "what does the code do." |
| [`superseded/`](superseded/) | Older design/analysis docs predating the real implementation, with their own banners. | Thesis history only. |
| [`hardware-verification/`](hardware-verification/), [`design-screenshots/`](design-screenshots/) | Captured evidence from prior verification passes. | You need proof a hardware or design check actually ran. |

---

## Rules for this folder

**1. Hardware facts must be sourced from the kiosk, never written from memory.**
Camera counts, locker counts, GPIO channel counts and per-locker timings all
come from `server/kiosk/kiosk_config.json`, `camera_manager.py`'s
`USB_DEVICE_MAP`, and `server/kiosk/KIOSK_CODE_SETUP.md` — not from an older
document and not from recollection. This has already gone wrong twice: the
public site's `about` page claimed five cameras after the face camera was
removed, and `KIOSK_CODE_SETUP.md` kept a code example calling a deleted
`capture_face` method plus a "confirm 5 camera nodes" step long after the
rest of the file had been corrected. **There are four cameras, one per locker.**

**2. Never bake a tunnel hostname into a document.** Cloudflare quick tunnels
rotate their hostname on every restart, so any URL written into a doc is wrong
the moment the tunnel restarts. Point at where the current value is actually
recorded (`startbat-logs/tunnel-*.log` on the host) instead.

**3. Superseded docs get moved to `predated/` and bannered inside the file, in
the same commit as their replacement lands.** Never deleted, and never left
looking current alongside the thing that replaced them — that's exactly how
the two stale audit docs became a hazard. See
[`redesign/REPO-HYGIENE.md`](redesign/REPO-HYGIENE.md).

**4. When you move a file, fix its inbound references** — but leave dated
session-log entries in `memory.md` alone. Those are a historical record; only
its current-state pointer table gets updated.

---

## What changed, 2026-09-05 (E0.4 of the redesign track)

- `audit/documentation.md`, `audit/phase4-audit-report.md` and `audit/history/`
  → moved to [`predated/audit/`](predated/audit/), each bannered.
- `planning/00-start-here.md` → moved to
  [`predated/planning/`](predated/planning/), bannered. The planning sequence
  now starts at `01-audit-prompt.md`.
- `docs/audit/` is now empty; the current audit is `Implemented.md` at the
  repo root, which is where `redesign/FOLDER-STRUCTURE.md` places it.
- `reference/analyzation.md` was **bannered in place** rather than moved — it
  is stale on kiosk/camera/endpoint specifics but its ML and data-model
  sections are not known to be stale. The banner names exactly which parts to
  distrust.
- Corrected in place: `KIOSK_CODE_SETUP.md` (a code example calling the
  deleted `capture_face`, and a "confirm 5 camera nodes" step),
  `planning/03-revamp-master.md` (self-test spec still said 5 cameras), and
  three hardcoded tunnel hostnames in `Implemented.md`.

See [`predated/README.md`](predated/README.md) for the full index of what was
archived, what date each file reflects, what superseded it, and what in it is
still true.
