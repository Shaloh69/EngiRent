# EngiRent Hub — Starting Prompt for Claude Code

Paste this into Claude Code at the repo root once `documentation.md`, `EngiRent_02_DESIGN_MANDATE.md`, and `EngiRent_03_REVAMP_MASTER.md` are all in the repo.

---

Read `documentation.md` in full — it's a verified, ground-truth audit of this codebase as it actually exists today, including the uncommitted working-tree changes present at audit time. Then read `EngiRent_03_REVAMP_MASTER.md` in full, **including §2 (Implementation research) before you touch any code** — it covers how to correctly handle the escrow/payout mechanism (PayMongo Disbursements, not the heavier Platforms/child-account model), biometric data security, the emergency-stop hardware pattern, and webhook signature enforcement, so you're not guessing or reinventing any of it. Then read `EngiRent_02_DESIGN_MANDATE.md` in full — it's referenced by the master prompt's Phase 3 and has already been corrected for the kiosk's real tech stack (Flask + vanilla JS, not React).

There's also a prior, separate audit-and-fix pass already sitting in this repo — `AUDIT.md` and `ENGIRENT_FULL_AUDIT_AND_REVAMP_PROMPT.md`, dated 2026-07-20. Treat its prose findings as reliable history, but **not** its "applied automatically" status checkboxes — five of them are confirmed stale against the current code (documentation.md §15.3, folded into Phase 0 item 8 of the master prompt). Don't re-verify that reconciliation yourself; it's already done.

The plan is seven phases: Phase 0 (critical security/financial-integrity fixes — start here, this system currently has a client-controlled payment amount and unencrypted biometric data in a public bucket, treat both as genuinely urgent), Phase 0.5 (hosting migration off Render onto my own PC — Tailscale device `desktop-gklhcri` — including MySQL and all image storage, since Supabase is being dropped entirely in favor of properly-structured local storage; plus a `Start.bat` for the PC and a proper `setup.sh` with systemd autorun for the Raspberry Pi, since it runs Linux, not Windows, and a components check on both sides), Phase 1 (functionality correctness), Phase 2 (feature completion — real escrow/payout, real security deposits, per-category late fees), Phase 3 (complete design overhaul per the design mandate), Phase 4 (full functional audit, including real test transactions through PayMongo's sandbox and the components check from Phase 0.5), and Phase 5 (commit, push, final README).

Work through the phases **in one continuous sweep** — don't stop for review after each phase. Only stop for:
- The four questions below, at the point each becomes relevant.
- Anything that turns out to need physical hardware access you don't have.
- A Phase 4 audit failure that needs fixing before Phase 5's push.

Otherwise keep moving through all seven phases and give me one summary at the end — file references for what changed, and anything you weren't able to verify or complete and why.

Four questions need my answer before you proceed past the point where they matter — don't decide any of them silently:
1. **The duplicate admin console** (Phase 2) — `client/admin` vs. the independent ~1300-line admin module inside the Flutter app (`admin_home_screen.dart`). I need to tell you which to keep.
2. **`client/web`'s scope** (Phase 2, Phase 3, and Phase 0.5) — whether this real fourth surface gets its own design pass, moves to the PC too, or stays as-is.
3. **The kiosk's design-mandate implementation path** (Phase 3) — migrate it to a small React build to share the same animation stack as the other two surfaces, or implement the same visual spec with vanilla-JS-compatible tools instead.
4. **Local storage's exact folder structure beyond the starting proposal** (Phase 0.5) — I've laid out a starting structure (`items/`, `verifications/`, `users/`) in the master prompt; tell me if you want it organized differently before it's locked in across every call site that gets rewired.

My laptop's Tailscale connection is showing expired again — I'll re-authenticate it before you need it for anything live.

One more thing on Phase 0.5's Components Check: surface it through the Admin Console, not just as command-line output. Before building anything new, check what's already there — `client/admin` already has a `kiosk` page, and the API already has `/admin/kiosks/events` (SSE telemetry) and `/admin/kiosks/:kioskId/command` (remote hardware commands) wired up. Extend that existing infrastructure — add a `self_test` command type, stream results back through the existing SSE channel, and build a real Health Check page in the admin console showing both the PC-side software checks and live per-Pi hardware status in one place. Don't leave any of this undiscovered or rebuilt in parallel — audit what's implemented first, then improve on it. Log this decision in the repo's own `memory.md` once it's done.

The emergency-stop fix (Phase 2) likely requires physical hardware rework, not just a GPIO/software change — flag that clearly when you get there rather than attempting a software-only substitute.

Do not push to `origin/main` in Phase 5 unless Phase 4's audit — including the real PayMongo sandbox payout/refund test — passed cleanly.

Start now with Phase 0.