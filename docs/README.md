# EngiRent Hub — Documentation Index

This folder holds every non-code document for the project, organized by why each one is kept. If you're looking for "what does the system actually do," start with `audit/documentation.md` — everything else here is either the plan that document feeds into, background reference it draws on, or history kept for the thesis write-up.

| Folder | Contents | Read this when... |
|---|---|---|
| [`audit/`](audit/) | `documentation.md` — the verified, file-cited ground truth of the codebase as it exists today. `history/` — the prior (2026-07-20) audit-and-fix pass. | You need to know what the code actually does, or why a past fix claim doesn't match reality. |
| [`planning/`](planning/) | The four-document sequence driving the current revamp: `00-start-here.md` → `01-audit-prompt.md` → `02-design-mandate.md` → `03-revamp-master.md`. | You're about to start or resume a revamp phase. |
| [`reference/`](reference/) | Authoritative background docs still accurate today: the ML pipeline's full technical writeup, the item-category survey data, and a full independent repo analysis. | You need detail beyond what fits in the audit (e.g. the exact math behind a verification stage, or per-category pricing guidance). |
| [`superseded/`](superseded/) | Older design/analysis docs that predate the real implementation and carry their own "superseded" banners. Kept for thesis-writeup history only — not authoritative. | You're writing the thesis narrative and want to show how the design evolved. Don't use these to answer "what does the code do." |

## Folder details

### `audit/`
- **`documentation.md`** — 18-section technical audit (system overview, architecture, API surface, DB schema, ML pipeline, hardware inventory, process flows, auth, config, deployment, drift log, feature matrix, known issues, open threads). Every claim is file:line-cited. This is the single source of truth for "what exists right now."
- **`history/AUDIT.md`** — a prior, separate audit-and-fix pass (2026-07-20). Its prose findings and severity ratings are reliable; its "applied automatically" status checkboxes are **not** — five of them turned out to be false when re-verified (see `documentation.md` §15.3). Kept as historical record, not as a current checklist.
- **`history/ENGIRENT_FULL_AUDIT_AND_REVAMP_PROMPT.md`** — the prompt that produced `AUDIT.md`. Same caveat applies.

### `planning/`
The active sequence for the ongoing revamp, meant to be read in order:
1. **`00-start-here.md`** — the kickoff message: read order, the six-phase plan, and three open questions that need the user's answer before certain phases proceed (duplicate admin console, `client/web`'s scope, kiosk React-vs-vanilla-JS).
2. **`01-audit-prompt.md`** — the original prompt that produced `audit/documentation.md`. Kept for provenance.
3. **`02-design-mandate.md`** — the full design-system directive (Mantine, "EngiRent Spectrum" palette, per-surface screen lists, the mandatory screenshot-verify loop). Already corrected for the kiosk's real stack (Flask + vanilla JS, not React).
4. **`03-revamp-master.md`** — the single source of truth for the revamp itself: implementation research (PayMongo Disbursements vs. Platforms, biometric handling, the emergency-stop hardware pattern) and the six phases (0 security/financial fixes → 1 functionality correctness → 2 feature completion → 3 design overhaul → 4 live functional audit → 5 commit/push/final README).

### `reference/`
- **`AI_SYSTEM_DOCUMENTATION.md`** — the authoritative technical writeup of the 8-stage hybrid CV verification pipeline (not YOLOv8) — stage-by-stage algorithms, weights, thresholds, API shapes.
- **`ITEM_CATEGORIES.md`** — survey-derived item categories, demand rankings, locker-size guidance, and suggested per-category pricing (cited by the revamp's per-category late-fee work).
- **`analyzation.md`** — an independent full-repository analysis; largely accurate, with one confirmed drift noted in `documentation.md` §15.2 (its API table predates the rental-status transition whitelist).

### `superseded/`
- **`AI_VERIFICATION_GUIDE.md`** — describes an early YOLOv8 design that was never shipped. Self-marked "superseded/historical."
- **`EngiRent_Hub_Analysis.md`** — process-flow diagrams still directionally useful, but names YOLOv8/GCash/AWS S3 and assumes a working escrow-release step that doesn't exist in code. Self-marked "partially superseded."

## Also see
- **`/README.md`** (repo root) — the project's public-facing overview, rewritten to match `audit/documentation.md`.
- **`/memory.md`** (repo root) — the assistant's running cross-session log of what's been done, decided, and is still pending on this revamp. Read this first if you're picking the revamp back up.
