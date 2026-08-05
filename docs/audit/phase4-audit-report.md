# Phase 4 — Live Functional Audit Report

Produced per `docs/planning/03-revamp-master.md` §7. This is meant to be **live verification, not another code read-through** — and where live verification genuinely wasn't possible this session, that's reported as a blocker below, not papered over with a code-level substitute presented as equivalent.

**Bottom line: this audit does not pass cleanly.** Two items are genuinely blocked on access this session doesn't have (a reachable database, a PayMongo sandbox key), one is blocked on physical hardware, and Phase 3's design work is an intentionally partial foundation (see `DESIGN.md`), not a finished four-surface rebuild. Per this repo's own hard constraint (`memory.md`: *"Never push to `origin/main` until Phase 4's audit — including a real PayMongo sandbox test — passes cleanly"*), **`origin/main` should not be pushed to based on this audit alone.** Phase 5's commit work proceeds locally; the push is withheld pending the blockers below.

---

## 1. API audit — re-verify Phase 0 fixes live

**Status: BLOCKED — no reachable database.**

- The local `.env`'s `DATABASE_URL` points at a remote Aiven-hosted MySQL instance that is currently unreachable (`npx prisma db push` → `P1001: Can't reach database server`), consistent with the Phase 0.5 migration being mid-flight (self-hosting moved off Render, but the DB hasn't been repointed at a locally-reachable instance yet).
- A **local MySQL 8.0 service is actually running** on this machine (port 3306, confirmed via `netstat`) — likely set up in anticipation of exactly this migration — but no credentials for it are available to this session, and guessing/brute-forcing a local root password was correctly out of scope regardless of convenience. This is worth the user's attention: pointing `DATABASE_URL` at that local instance (once credentials are in hand) would unblock this entire section without needing Tailscale or the remote DB at all.
- Docker is installed but its daemon isn't running; starting Docker Desktop to spin up a disposable database was deliberately not done unprompted — that's a real environment change (a virtualization engine, potential port conflicts with the MySQL service already running) beyond what this session's other actions have done, and wasn't worth doing silently for an audit item that has a more direct fix (real DB credentials).
- **What was actually verified instead**: the same code paths, exercised as Jest unit tests against a mocked Prisma client (not a live HTTP call, not a real server, not a real database — genuinely narrower than what this section asks for):
  - Client-controlled payment amount → `paymentController.test.ts`, "ignores a client-supplied amount and charges the rental's real totalPrice" — passes.
  - Non-owner locker release → `kioskController.test.ts`, "rejects a student who has no relation to the rental occupying the locker" — passes.
  - Malformed webhook signature → `paymentController.test.ts`'s "confirmPayment — webhook signature verification" block (5 tests: missing header, tampered signature, unset-secret fails closed, valid signature accepted, non-webhook body rejected in production) — all pass.
  - Also covers the Phase 2 gating fix (both RENTAL_PAYMENT and SECURITY_DEPOSIT required before a rental advances) — 2 tests, both pass.
- **Verdict: PARTIAL.** Logic is verified at the unit level (43/43 Jest tests passing); it has not been verified live, as this section requires. Re-run this specific section once `DATABASE_URL` points at a reachable instance.

## 2. Real payment/payout verification (PayMongo sandbox)

**Status: BLOCKED — no PayMongo sandbox/test key available.**

- `Start.bat`'s own Components Check already checks for a placeholder `PAYMONGO_SECRET_KEY` value; no real sandbox key was supplied to or found in this session's environment.
- This is explicitly called out in the plan as *"the single most important check in this phase"* — it cannot be faked or approximated. The Phase 2 code (real `createRefund`/`createTransfer` calls via `rentalSettlementService.ts`) has never executed against PayMongo's actual API; its correctness rests on the published API docs fetched during Phase 2 (see `memory.md`'s Phase 2 entry for exactly which parts of that are unconfirmed — the `receiving_institutions` response shape, and whether omitting `source_account` really defaults to the platform wallet).
- **Verdict: NOT DONE.** Requires the user to supply a real PayMongo test-mode secret key, then run one real rental through checkout → completion → payout and confirm an actual Transfer + refund fire.

## 3. Biometric storage verification

**Status: PARTIAL — mechanism verified, live data not inspected.**

- Cannot inspect a real stored `User.faceEncoding` row for the same reason as §1 (no reachable database).
- **What was verified**: `crypto.test.ts` (9 tests, all passing) exercises the actual `encryptJson`/`decryptJson`/`isEncryptedBlob` functions used to encrypt `faceEncoding` — confirms the AES-256-GCM round-trip is correct, confirms tampering is detected, confirms legacy-plaintext tolerance in `decryptFaceEncoding`. `storageService.test.ts` (14 tests, all passing) confirms the signed-URL mechanism (HMAC signature, TTL expiry, path-traversal rejection) that serves face/ID images works correctly in isolation.
- **What was not verified**: that a real row in a real database actually contains ciphertext (not plaintext), and that a real signed URL for a real stored image is genuinely time-limited when hit over real HTTP. Both require the same DB/server access blocked in §1.
- **Verdict: PARTIAL.** The mechanism is sound and unit-tested; live confirmation is blocked on the same DB access gap as §1.

## 4. Hardware verification

**Status: BLOCKED — no live kiosk/Tailscale access, as anticipated from the start of this session.**

- Consistent with `memory.md`'s "Known hard constraints" section (written before any Phase 0 code was touched): the user's Tailscale connection was already noted as expired, and this session has no path to the physical Raspberry Pi kiosk.
- Cannot confirm the new "AI verification in progress" kiosk state (`server/kiosk/kiosk_ui`'s `S.VERIFYING` state, added in Phase 1) actually appears on real hardware and suspends the inactivity timeout correctly — this was verified by code review and the `_resetInactivity()` early-return logic at the time, not a live device.
- Cannot confirm the emergency-stop's hardware half, because that hardware half was never built this session (Phase 2 — flagged as requiring physical wiring rework, out of scope for an unattended session). The software half (the `kiosk_emergency` event/logging/admin-notification layer added in Phase 2) has no hardware component to verify here.
- **Verdict: NOT DONE**, exactly as flagged when this constraint was first written, before any implementation began.

## 5. Design verification

**Status: PASS, for the honestly-reduced scope `DESIGN.md` actually claims.**

- `DESIGN.md` exists at the repo root and is explicit that Phase 3 delivered a **verified foundation**, not a completed four-surface rebuild — it does not claim more than what's backed by screenshots.
- Confirmed both screenshots referenced in `DESIGN.md` (`docs/design-screenshots/admin-dashboard-mantine.png`, `admin-users-unmigrated.png`) are real Playwright captures of the actually-running Admin Console (verified again this session by re-reading them), not descriptions or mockups.
- Confirmed the claims in `DESIGN.md` match the code: `client/admin/src/app/theme.ts` genuinely implements the mandated palette, `AdminLayout.tsx` genuinely uses Mantine `AppShell` + `Spotlight`, `dashboard/page.tsx` genuinely uses a real `BarChart` fed by a real (not placeholder) `rentalsByCategory` aggregate added to `GET /admin/stats`.
- Kiosk, Phone App, and `client/web` are correctly reported as not started — verified by their absence of any Mantine/Vite/Lottie-related changes in this session's diff.
- **Verdict: PASS** on "does `DESIGN.md` genuinely match what was built" — the honest scope itself is a separate, larger open item, not a failure of this specific audit check.

## 6. Test infrastructure verification

**Status: PASS locally; gap fixed this session for CI.**

- **Runs and asserts meaningfully, locally**: re-ran both suites fresh — `npx jest` in `server/node_server`: **43/43 passing** across 5 suites (crypto, storageService, paymentController, rentalController, kioskController); `python -m pytest tests/` in the ML service: **5/5 passing**. Every test file carries a comment tying it to the specific Phase 0/1/2 fix it covers, not generic scaffolding with no real assertions.
- **Did not previously run in CI at all** — no `.github/workflows/` existed before this audit (only unrelated tooling scripts under `.github/java-upgrade/` and `.github/modernize/`). **Fixed as part of this audit**: added `.github/workflows/test.yml`, running the Node Jest suite and the ML service's pytest suite (installing only the lightweight deps `test_api_key_gate.py` actually needs — `fastapi`/`pydantic-settings`/`pytest`/`httpx` — not the full CV/DL stack, made possible by the `app/security.py` extraction done in Phase 1) on every push/PR to `main`.
- **Verdict: PASS**, now that the CI gap is closed. Not yet confirmed green on GitHub Actions itself (that only happens once this branch is actually pushed) — a reasonable expectation given the workflow mirrors exactly what was just re-run locally.

---

## Summary

| # | Item | Verdict |
|---|---|---|
| 1 | API audit (live re-verification of Phase 0 fixes) | PARTIAL — unit-verified, not live (blocked: no reachable DB) |
| 2 | Real PayMongo sandbox payout/refund test | NOT DONE (blocked: no sandbox key) |
| 3 | Biometric storage verification | PARTIAL — mechanism verified, live data not inspected (blocked: no reachable DB) |
| 4 | Hardware verification | NOT DONE (blocked: no physical/Tailscale access, as anticipated) |
| 5 | Design verification | PASS (for the honestly-reduced scope `DESIGN.md` claims) |
| 6 | Test infrastructure verification | PASS (CI gap found and fixed this session) |

**Per this repo's own hard constraint, `origin/main` is not pushed to based on this result.** Phase 5 proceeds with local commits, the AUDIT.md/history reconciliation, and the final README pass — all of which are safe and valuable regardless of the blockers above — but the push itself waits on at least items 1-3 being genuinely re-run once a reachable database and a PayMongo sandbox key are available, and ideally item 4 once physical/Tailscale access returns.
