# docs/predated/ — Superseded Documentation

Everything in this folder is **history, not current status**. It is kept
because it is the project's engineering record and several files are cited by
other documents — per `docs/redesign/REPO-HYGIENE.md`, superseded docs are
**moved and bannered, never deleted**.

Every file here carries a `> SUPERSEDED` banner at the top of the file itself,
so a reader who arrives via search or a direct link sees its status without
ever noticing the folder name.

**The current sources of truth are:**

| For | Read |
|---|---|
| What is actually implemented | `Implemented.md` (repo root, 2026-09-04) |
| What happened, and why, across sessions | `memory.md` (repo root) — the running log |
| The active redesign track | `docs/redesign/` |
| Live track state and the three registers | `docs/PROGRESS.md` |

---

## Index

### `audit/documentation.md`
- **What it was:** the 18-section, file:line-cited ground-truth codebase audit
  that kicked off the revamp. Written from an independent re-verification
  using three parallel research agents.
- **Date it reflects:** 2026-08-05.
- **Superseded by:** `Implemented.md` (2026-09-04).
- **Known stale:** §6, §8, §9, §10, §13 — all describe the pre-2026-09-03
  kiosk-camera face flow and the now-retired `claimItem`/`returnItem`
  endpoints. The kiosk's face camera was **physically removed** 2026-09-03;
  face verification now happens on the user's phone.
- **Still true:** the general API and schema description, the drift log against
  prior docs (§15), and its severity reasoning.

### `audit/phase4-audit-report.md`
- **What it was:** the Phase 4 live functional audit — what was re-verified
  against a running system versus what was blocked on access.
- **Date it reflects:** 2026-08-10.
- **Superseded by:** `Implemented.md` (2026-09-04).
- **Known stale:** kiosk and hardware sections, same reason as above. Most of
  its open blockers were addressed or re-scoped on 2026-09-03 — see
  `memory.md`'s entries for that date. **The PayMongo sandbox item is still
  genuinely open.**
- **Still true:** its method (live verification over another code read-through)
  and its discipline of reporting blockers rather than substituting a
  code-level check presented as equivalent.

### `audit/history/AUDIT.md`
- **What it was:** the first audit-and-fix pass.
- **Date it reflects:** 2026-07-20.
- **Superseded by:** `audit/documentation.md`, then `Implemented.md`.
- **Known stale — and this one is a trap:** its **status checkboxes are not
  reliable.** Five "applied automatically" fix claims were not actually in the
  code (mlFeatures cache invalidation, persistMlFeatures removal, the `Rental`
  composite index, the `actuator_speed_percent` cleanup, the per-category late
  fee). All five were genuinely fixed later, in Phase 0.
- **Still true:** its prose findings and severity ratings.

### `audit/history/ENGIRENT_FULL_AUDIT_AND_REVAMP_PROMPT.md`
- **What it was:** the prompt that produced `AUDIT.md`.
- **Date it reflects:** 2026-07-20.
- **Superseded by:** `docs/redesign/KICKOFF_PROMPT.md`.

### `planning/00-start-here.md`
- **What it was:** the original revamp kickoff prompt.
- **Date it reflects:** 2026-08-05.
- **Superseded by:** `docs/planning/04-continue-design-redo.md`, explicitly.
- **Known stale:** its "stop after each phase" instruction was overridden the
  same day — see `memory.md` § "Execution mode (updated 2026-08-05)".
- **Still true:** the framing of the revamp's phase sequence.

---

## Judgment call recorded

`docs/redesign/REPO-HYGIENE.md` names three files to archive
(`audit/documentation.md`, `audit/phase4-audit-report.md`,
`planning/00-start-here.md`). **`docs/audit/history/` was moved here too**,
which the doc does not explicitly name — but it dates to 2026-07-20, its own
successor calls its status claims unreliable, and `REPO-HYGIENE.md`'s target
structure states that `docs/audit/` holds **current audits only**. Leaving a
folder named `history/` inside a folder designated current-only contradicted
that target. Flagged here rather than done silently.

This left `docs/audit/` empty; `Implemented.md` stays at the repo root, which
is where `docs/redesign/FOLDER-STRUCTURE.md` places it and where the kickoff
prompt's read list points.
