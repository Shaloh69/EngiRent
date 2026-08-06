# Phase 4 — Live Functional Audit Report

Produced per `docs/planning/03-revamp-master.md` §7. This is meant to be **live verification, not another code read-through** — and where live verification genuinely wasn't possible this session, that's reported as a blocker below, not papered over with a code-level substitute presented as equivalent.

**Bottom line: this audit does not pass cleanly.** Two items are genuinely blocked on access this session doesn't have (the real production database, a PayMongo sandbox key) and one is blocked on physical hardware. A disposable, self-contained Docker MySQL dev database (spun up in a same-session continuation, see the item 1/3/5 updates below and `memory.md`'s session log) partially unblocked live re-verification and let Phase 3's design work finish for three of four surfaces — but per the user's own explicit instruction, **that dev-database work does not mean Phase 4 passes cleanly**: the real production database and a real PayMongo sandbox key are still missing. Per this repo's own hard constraint (`memory.md`: *"Never push to `origin/main` until Phase 4's audit — including a real PayMongo sandbox test — passes cleanly"*), **`origin/main` should not be pushed to based on this audit alone.** Phase 5's commit work proceeds locally; the push is withheld pending the blockers below.

---

## 1. API audit — re-verify Phase 0 fixes live

**Status: PARTIAL — re-verified live against a disposable Docker dev database, not the real production database.**

- **Update (2026-08-06, same-session continuation)**: per explicit user direction, a fully self-contained, disposable MySQL 8.0 container (`engirent-mysql-dev`, generated root credentials, port 3308) was spun up specifically to unblock local dev/testing — **not** to stand in for a genuine Phase 4 pass. `npx prisma db push` created the real schema against it; the Node API ran for real (`Start-Dev.bat` / `.env.dev`) against this database.
- With that live database reachable, the Phone App was driven end-to-end through the **real running Node API** (via Playwright, not mocked): real `/auth/register` and `/auth/login`, real authenticated `GET` calls rendering actual seeded data (items list, item detail, rentals list, an active and a completed rental's detail, notifications, profile, payout details), real navigation into the create-rental/checkout and create-item screens. This is genuine live confirmation that the core CRUD/auth paths work end-to-end against a real server + real database, which the Jest suite alone couldn't show.
- **This does not, however, re-verify the specific Phase 0 security fixes this section originally asked about.** No webhook `confirmPayment` call with a tampered/client-controlled amount was actually sent during this pass (checkout was reached and screenshotted, not driven through a real PayMongo-signed webhook, since no sandbox key exists — see §2), and no real kiosk locker-release authorization check was exercised (that requires either real kiosk hardware or a deliberately-crafted authorization test, neither of which this pass did). Those two specific fixes remain verified only at the Jest-mock level, exactly as before.
- **This still does not satisfy this section as originally scoped.** The database is a throwaway local container with synthetic seed data, not the real (previously-Aiven-hosted, now-to-be-self-hosted) production database this session still has no credentials/reachability for. The original blocker — a **local MySQL 8.0 service already running on this machine (port 3306)**, presumably set up for the real self-hosted migration, with no credentials available to this session — remains exactly as described below, untouched by this update.
- **What was verified at the unit level (unchanged from before)**: `paymentController.test.ts`, `kioskController.test.ts` — same as originally documented, all still passing (43/43 Jest).
- **Verdict: PARTIAL, upgraded from "unit-only" to "core CRUD/auth paths live-verified against a disposable dev DB."** The client-controlled-payment-amount and kiosk-locker-authorization fixes specifically are still unit-verified only, not live. Re-run this section fully once `DATABASE_URL` points at the real production/self-hosted instance.

## 2. Real payment/payout verification (PayMongo sandbox)

**Status: BLOCKED — no PayMongo sandbox/test key available.**

- `Start.bat`'s own Components Check already checks for a placeholder `PAYMONGO_SECRET_KEY` value; no real sandbox key was supplied to or found in this session's environment.
- This is explicitly called out in the plan as *"the single most important check in this phase"* — it cannot be faked or approximated. The Phase 2 code (real `createRefund`/`createTransfer` calls via `rentalSettlementService.ts`) has never executed against PayMongo's actual API; its correctness rests on the published API docs fetched during Phase 2 (see `memory.md`'s Phase 2 entry for exactly which parts of that are unconfirmed — the `receiving_institutions` response shape, and whether omitting `source_account` really defaults to the platform wallet).
- **Verdict: NOT DONE.** Requires the user to supply a real PayMongo test-mode secret key, then run one real rental through checkout → completion → payout and confirm an actual Transfer + refund fire.

## 3. Biometric storage verification

**Status: PARTIAL — mechanism verified, live data still not inspected. Unchanged by the Docker dev-database work.**

- **Checked during the same-session Docker dev-database work (§1), for completeness**: queried the seeded users table directly (`docker exec engirent-mysql-dev mysql ... SELECT id, email, faceEncoding FROM users`) — every seeded user's `faceEncoding` is `NULL`. `prisma/seed.ts` was extended this session to set `profileComplete`/`biometricConsentAt` on seeded students (to reach past the app's profile-completion gate without a live capture), but deliberately does **not** fabricate a `faceEncoding` value, since seed data can't realistically simulate a live biometric-capture flow. So this dev database has nothing to confirm ciphertext-vs-plaintext against — it doesn't close this section's original gap, it just confirms the gap is unchanged.
- **What was verified at the unit level (unchanged from before)**: `crypto.test.ts` (9 tests, all passing) exercises the actual `encryptJson`/`decryptJson`/`isEncryptedBlob` functions used to encrypt `faceEncoding` — confirms the AES-256-GCM round-trip is correct, confirms tampering is detected, confirms legacy-plaintext tolerance in `decryptFaceEncoding`. `storageService.test.ts` (14 tests, all passing) confirms the signed-URL mechanism (HMAC signature, TTL expiry, path-traversal rejection) works correctly in isolation.
- **What still isn't verified**: that a real row from a real (production or biometric-onboarded) user actually contains ciphertext, and that a real signed URL for a real stored image is genuinely time-limited when hit over real HTTP. Confirming this requires actually completing a live biometric-consent/face-capture flow against a running instance — not just having a reachable database — so re-running this section needs more than pointing `DATABASE_URL` somewhere reachable.
- **Verdict: PARTIAL, unchanged.** The mechanism is sound and unit-tested; live confirmation of real encrypted data remains unverified.

## 4. Hardware verification

**Status: BLOCKED — no live kiosk/Tailscale access, as anticipated from the start of this session.**

- Consistent with `memory.md`'s "Known hard constraints" section (written before any Phase 0 code was touched): the user's Tailscale connection was already noted as expired, and this session has no path to the physical Raspberry Pi kiosk.
- Cannot confirm the new "AI verification in progress" kiosk state (`server/kiosk/kiosk_ui`'s `S.VERIFYING` state, added in Phase 1) actually appears on real hardware and suspends the inactivity timeout correctly — this was verified by code review and the `_resetInactivity()` early-return logic at the time, not a live device.
- Cannot confirm the emergency-stop's hardware half, because that hardware half was never built this session (Phase 2 — flagged as requiring physical wiring rework, out of scope for an unattended session). The software half (the `kiosk_emergency` event/logging/admin-notification layer added in Phase 2) has no hardware component to verify here.
- **Verdict: NOT DONE**, exactly as flagged when this constraint was first written, before any implementation began.

## 5. Design verification

**Status: PASS, for the honestly-reduced scope `DESIGN.md` actually claims.**

- `DESIGN.md` exists at the repo root and is explicit about exactly what's real per surface, not more.
- **As originally audited (Admin Console only)**: confirmed the two screenshots then referenced (`docs/design-screenshots/admin-dashboard-mantine.png`, `admin-users-unmigrated.png`) are real Playwright captures of the actually-running Admin Console, and that `client/admin/src/app/theme.ts`/`AdminLayout.tsx`/`dashboard/page.tsx` genuinely match what `DESIGN.md` claimed. At that point Kiosk, Phone App, and `client/web` were correctly reported as not started.
- **Update (2026-08-06, same-session continuation, per the user's explicit follow-up instruction to keep going on Phase 3 design work)**: Kiosk (full React/Vite migration, 9 screens), `client/web` (full HeroUI→Mantine migration, 5 pages), and the Phone App (full re-theme, real-backend-verified, all screens) are now all genuinely done, not just started — each backed by real Playwright screenshots in `docs/design-screenshots/`, cross-checked against the actual code this session (theme files, component migrations, the Phone App's real SliverAppBar bug fix and animated status badge). Only the Admin Console remains a partial foundation (~9 pages still on HeroUI).
- **Verdict: PASS** on "does `DESIGN.md` genuinely match what was built" — three of four surfaces are now fully done and verified; the Admin Console's remaining backlog is tracked honestly, not a failure of this specific audit check.

## 6. Test infrastructure verification

**Status: PASS locally; gap fixed this session for CI.**

- **Runs and asserts meaningfully, locally**: re-ran both suites fresh — `npx jest` in `server/node_server`: **43/43 passing** across 5 suites (crypto, storageService, paymentController, rentalController, kioskController); `python -m pytest tests/` in the ML service: **5/5 passing**. Every test file carries a comment tying it to the specific Phase 0/1/2 fix it covers, not generic scaffolding with no real assertions.
- **Did not previously run in CI at all** — no `.github/workflows/` existed before this audit (only unrelated tooling scripts under `.github/java-upgrade/` and `.github/modernize/`). **Fixed as part of this audit**: added `.github/workflows/test.yml`, running the Node Jest suite and the ML service's pytest suite (installing only the lightweight deps `test_api_key_gate.py` actually needs — `fastapi`/`pydantic-settings`/`pytest`/`httpx` — not the full CV/DL stack, made possible by the `app/security.py` extraction done in Phase 1) on every push/PR to `main`.
- **Verdict: PASS**, now that the CI gap is closed. Not yet confirmed green on GitHub Actions itself (that only happens once this branch is actually pushed) — a reasonable expectation given the workflow mirrors exactly what was just re-run locally.

---

## Summary

| # | Item | Verdict |
|---|---|---|
| 1 | API audit (live re-verification of Phase 0 fixes) | PARTIAL — core CRUD/auth live-verified against a disposable dev DB; the two named security fixes (payment-amount override, kiosk locker auth) still unit-only (blocked: no reachable *production* DB) |
| 2 | Real PayMongo sandbox payout/refund test | NOT DONE (blocked: no sandbox key) |
| 3 | Biometric storage verification | PARTIAL, unchanged — mechanism verified, no real biometric data exists anywhere to inspect yet (blocked: no reachable *production* DB with real biometric-onboarded users) |
| 4 | Hardware verification | NOT DONE (blocked: no physical/Tailscale access, as anticipated) |
| 5 | Design verification | PASS — see update below; Kiosk, `client/web`, and the Phone App are now genuinely done, not just Admin Console's foundation |
| 6 | Test infrastructure verification | PASS (CI gap found and fixed this session) |

**Update (2026-08-06, same-session continuation)**: a disposable, fully self-contained Docker MySQL dev database was stood up per explicit user direction — see `memory.md`'s session log for the full account. This upgraded item 1 from unit-only to live-verified for the core CRUD/auth paths, and let Phase 3's Phone App work (§5) finish for real against a live backend instead of the demo-mode bypass previously used. **It explicitly does not clear items 2 or 4, and does not fully clear item 1 or 3** — both remain gated on the real production database and a real PayMongo sandbox key, neither of which this update provides. Per the user's own explicit instruction: *"Don't report Phase 4 as fully passing based on the Docker version alone."*

**Per this repo's own hard constraint, `origin/main` is not pushed to based on this result.** Phase 5 proceeds with local commits, the AUDIT.md/history reconciliation, and the final README pass — all of which are safe and valuable regardless of the blockers above — but the push itself waits on at least items 1-3 being genuinely re-run once the real production database and a PayMongo sandbox key are available, and ideally item 4 once physical/Tailscale access returns.
