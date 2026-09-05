# EngiRent — Implementation Audit

**Generated 2026-09-04**, from a full read of the codebase as it exists in this repository (not from prior audit docs — those are cross-checked, not trusted; see §8). Covers every surface: the Node/Express API, the Python ML verification service, the Raspberry Pi kiosk (hardware + local UI), the Next.js admin console, the Flutter mobile app, and the public Next.js website.

This is a snapshot. The most recent major change — moving face verification off the kiosk and onto the user's phone, and the deployment that followed — happened the same day this audit was written; every section below reflects that change, not the architecture that preceded it.

---

## 1. Executive Summary

| Surface | State |
|---|---|
| Node/Express API | Real, broad, no stub controllers. 2 routes are intentionally wired to always fail (retired endpoints). Payments run through a documented mock-checkout fallback in production right now (no PayMongo key configured). Test coverage is narrow (4 controllers, fully mocked DB). |
| ML verification service | Real 8-signal hybrid comparison pipeline for item photos, with real, non-trivial thresholds. Face verification code still exists here (dual dlib/Haar-cascade path) but is no longer called by the kiosk — only the phone app's flow reaches it now, via the Node proxy. Auth fails open if `ML_API_KEY` is unset. |
| Kiosk (Pi hardware + local UI) | Real GPIO/relay/camera control, hand-calibrated per-locker timing. Face camera physically removed 2026-09-03; all supporting code removed with it. Two now-dead UI screens (QR/Confirm) and one dead Node socket handler left in place, flagged not deleted. |
| Admin console | Every listed page hits real endpoints (no page found stub-only). No client-side auth/role guard beyond token presence — the Reviewer/Admin split exists only server-side, unenforced in this UI. Zero automated tests. |
| Flutter app | Every screen makes real API/socket calls. A debug-only fallback fabricates data on network failure (compiled out of release builds). Localization is a thin veneer — 32 of hundreds of strings are translated; most of the app stays English regardless of language setting. 2 unit tests total, no widget/integration tests. |
| Public website | Real, mostly accurate. One page (`about`) claimed a hardware fact (camera count) that went stale the same day the hardware changed — found and fixed as part of this audit. |
| Documentation | Two prior audit docs (`docs/predated/audit/documentation.md`, `phase4-audit-report.md`) predate the face-camera removal and are now stale on kiosk/hardware sections specifically — the README already flags them as historical, so this isn't a surprise, but their kiosk-hardware sections should not be trusted for current facts. |
| Database (live) | Wiped of all non-admin data same day, on explicit instruction. 1 user (admin), 0 rentals/reviews/items. |

---

## 2. Consolidated Problems List

Ordered roughly by how likely each is to bite a real user or grader first.

1. **Payments run through a mock checkout in the live deployment right now.** No `PAYMONGO_SECRET_KEY` is configured; `paymentController.ts:245` falls back to `${CLIENT_WEB_URL}/payments/mock?tid=...`. Not a bug — it's a documented, gated fallback — but it means real money never actually moves in the current deployment. *(Node API agent)*

2. **ML service auth fails open by default.** `app/security.py`'s `require_api_key` is a no-op whenever `ML_API_KEY` is unset (`config.py` defaults it to `""`). If that env var isn't set wherever the ML service actually runs, every endpoint — including face and item verification — is unauthenticated. *(ML service agent)*

3. **Face-verification fallback is materially weaker, and silently breaks re-registration.** If `face_recognition` (dlib) fails to import, `verification.py` drops to Haar-cascade + 64-bin color-histogram matching — no real identity encoding, easily fooled by similar lighting/skin tone. In that mode, `register_face` *always* returns `success: false` (can't produce a persistable encoding), which would silently prevent anyone from completing profile setup while dlib is unavailable. `face_recognition==1.3.0` is only installed via a bespoke Dockerfile step, not a normal `requirements.txt` line — building the service any other way lands in this weaker mode with only a log line, no error. *(ML service agent)*

4. **Localization covers ~32 strings out of hundreds.** The app ships `en`/`fil`/`ceb` locale files, fully translated — but only for auth screens, bottom nav, and the home dashboard's rental section. All other screens (items, kiosk, payments, feedback, reviews, messages — roughly 20 screens) are hardcoded English regardless of language selection. Nothing marks this as incomplete anywhere in code. *(Flutter agent)*

5. **Two REST endpoints are live-routed but always return an error.** `POST /kiosk/claim` and `POST /kiosk/return` are still registered in `kioskRoutes.ts` and reachable, but both handlers unconditionally `next(new ValidationError(...))` — retired 2026-09-03 when the kiosk's face camera (which they used to command directly) was removed. Well-documented in the controller, but a caller sees a 400, not a 404/410, and the routes remain discoverable. *(Node API agent, confirmed firsthand — this session retired them)*

6. **No client-side role enforcement in the admin console.** Any Reviewer-vs-Admin distinction is backend-only; the UI has no role check anywhere, no per-page guard beyond "is there a token in localStorage." *(Admin console agent)*

7. **Debug-only data fabrication on network failure.** `AppConstants.demoMode` (gated by `kDebugMode`, defaults `USE_DEMO_MODE=true`) makes `auth_service`, `item_service`, `rental_service`, and `notification_service` silently show fabricated data if a real API call throws, in any debug build. Compiled out of release builds, but could mask a real bug during development or a live demo run from an unreleased build. *(Flutter agent)*

8. **Automated test coverage is thin everywhere.** Node: 4 of ~10 controllers, fully mocked DB, no integration tests (real coverage comes from manually-run `scripts/e2e-*.mjs` against a live server). Admin console: zero tests, no test tooling installed at all. Flutter: 2 unit tests (an offline-queue guard and a PII log-scrubber), zero widget/integration tests across 24 screens. ML service: 5 tests, all narrowly on the API-key gate — none on the comparison algorithm, thresholds, or SSRF guard. *(all four agents)*

9. **Inconsistent hardcoded kiosk-ID fallbacks in the admin console.** `kiosk/page.tsx` falls back to `"KIOSK-001"`; `health/page.tsx` falls back to `"kiosk-1"` — different casing/format for the same concept, in two files. Both pages also duplicate the API base-URL fallback (`http://localhost:5000/api/v1`) outside the shared axios client for their raw SSE `fetch()` calls. *(Admin console agent)*

10. **A settle/dispute-resolution endpoint exists with no UI to trigger it.** `POST /admin/rentals/:id/settle` is implemented server-side and even mocked in the admin console's demo adapter, but no page (`disputes/page.tsx`, `rentals/[id]/page.tsx`) actually calls it — disputes can be *viewed* in the admin console but not *resolved* from it. *(Admin console agent)*

11. **OCR match gives a flat +10-point bonus to the item-verification score**, uncapped by context — `hybrid.py:251-252` — which could push a middling comparison (e.g. 76/100) over the 85-point auto-approve threshold on a serial-number OCR match alone, regardless of how weak the visual signals were. *(ML service agent)*

12. **Stale documentation, now fixed as part of this audit:** the public site's `about` page claimed "five cameras" (fixed → four), `client/web/config/site.ts`'s GitHub link was a bare placeholder `https://github.com/` (fixed → the real repo URL), and `server/kiosk/KIOSK_CODE_SETUP.md` had five separate lines still describing the removed 5-camera/face-camera setup despite its own opening paragraph correctly noting the removal (all five now corrected). *(docs agent, fixed same session)*

13. **Two prior audit documents are now stale on kiosk/hardware specifics.** `docs/predated/audit/documentation.md` §6, §8, §9, §10, §13 and `docs/predated/audit/phase4-audit-report.md` describe the pre-2026-09-03 kiosk-camera-based face flow and the now-retired `claimItem`/`returnItem` endpoints. The README already frames `documentation.md` as historical, so this isn't a hidden trap, but anyone reading those files for current hardware/API facts should not trust the kiosk-specific sections. *(docs agent)*

14. **Two vestigial, unreachable code paths were left in place rather than removed**, to bound the size of the 2026-09-03 architecture change: the kiosk React UI's `QrScreen`/`ConfirmScreen` and their `"qr"`/`"confirm"` states (the reversed-direction QR flow they supported no longer has a camera to run it), and the Node `kiosk:face` socket handler (nothing emits that event anymore). Both are commented as dead in code, not deleted. *(firsthand, this session)*

15. **Flutter build tooling is out of sync with the installed SDK.** The current Flutter SDK requires Gradle ≥8.14; `gradle-wrapper.properties` is pinned to 8.12. Builds currently succeed only via `--android-skip-build-dependency-validation`. Real fix (bumping the wrapper) not yet done. *(firsthand, this session)*

---

## 3. Node / Express API — `server/node_server`

### 3.1 Routes

**Auth** (`/api/v1/auth`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /register | none | email, password≥8, studentId, firstName, lastName, **`phoneNumber`** (corrected 2026-09-06 — this table said `phone`; `authRoutes.ts:37` validates `phoneNumber` with `isMobilePhone("any")`, so a client following this doc gets a 400) |
| POST | /login | none | email, password |
| POST | /refresh | none | refreshToken |
| POST | /logout | authenticate | |
| GET/PUT | /profile | authenticate | |
| POST | /profile/complete | authenticate | |
| POST | /register-face | authenticate + upload | proxies to ML service — see §5.3 |
| POST | /id-photo | authenticate + upload | |
| PUT | /payout-destination | authenticate | provider enum, bank/e-wallet details |
| PUT | /password | authenticate | |
| DELETE | /account | authenticate | requires password |

**Items** (`/items`): POST / (auth+verified), GET / (optional auth), GET /my-items (auth), GET /:id/booked-dates (optional auth), GET /:id (optional auth), PUT/DELETE /:id (auth).

**Rentals** (`/rentals`): POST / (auth+verified), GET / and GET /:id (auth), PATCH /:id/status (auth), POST /:id/cancel (auth), PATCH /:id/dates — extend (auth), GET /:id/conversation and POST /:id/conversation/messages (auth).

**Payments** (`/payments`): POST / — createPayment (auth), POST /confirm — webhook, signature-verified internally not route-gated, GET / — transactions (auth), GET /status/:transactionId (auth), GET /receiving-institutions (auth), POST /:transactionId/refund (auth).

**Kiosk** (`/kiosk`): POST /deposit (auth), POST /claim and POST /return (auth — **always error; repo now returns 410 Gone, but the deployment still answers 400 — see PROGRESS.md D-32**), GET /lockers (auth), POST /lockers/:id/release (auth), POST /session/start (auth), POST /upload (kiosk shared-secret), **POST /verify-face (auth + upload — the real phone-side verification endpoint, see §6)**.

**Notifications** (`/notifications`, all authenticate): GET /, GET/PUT /preferences, PATCH /:id/read, PATCH /read-all, DELETE /:id.

**Reviews** (`/reviews`): POST / (auth), GET /me (auth), GET /item/:itemId and GET /user/:userId (public).

**Feedback** (`/feedback`): POST / (auth, rate-limited 8/15min, optional file upload), GET /mine (auth).

**Admin** (`/admin`, all authenticate + role-gated per route — `requireAdmin` or the looser `requireStaff` for Admin-or-Reviewer): stats, users (list/detail/patch/create-admin), audit-log, rentals (list/complete/conversation/settle), transactions (list/refund/decide-payment), verifications (AI condition checks), id-verifications (`requireStaff`), items (bulk moderate, detail, reviews — `requireStaff`), reviews/:id delete, feedback (`requireStaff`), reports, health, kiosks (SSE event stream, list, config get/put, command).

**Upload** (`/upload`): POST /image, POST /images (auth, inline handlers not in a controller file).

**Media** (`/media`, mounted separately, not under the versioned `/api/v1` router aggregation): GET /items/:batchId/:filename (public), GET /users/:userId/face.jpg (auth), GET /secure/:token (signed-token, no session) — worth a follow-up check that this mount is intentional and not an oversight.

Plus `GET /app-config` and `GET /health`, defined directly in `routes/index.ts`.

### 3.2 Socket.io surface (`src/index.ts`)

Server listens for: `join`, `kiosk:register`, `kiosk:ack`, `kiosk:status`, `kiosk:images`, `kiosk:face` *(dead — nothing emits it any more, see §6)*, `kiosk:rental_lookup`, `kiosk:admin_snapshot`, `kiosk:flow_start`, `kiosk:error`, `kiosk:self_test_result`, `kiosk:log`, `app:kiosk_scan`, `kiosk:scan_error_relay`, `disconnect`.

Server emits (to various rooms): `rental:completed`, `kiosk:config`, `admin:kiosk_online`, `admin:kiosk_ack`, `admin:kiosk_status`, `kiosk:command` (multiple action variants), `deposit:retry`/`deposit:rejected`/`deposit:approved`, `return:retry`/`return:disputed`/`return:under_review`, `face:failed`/`face:verified`, `rental:active`, `kiosk:rental_info`, `kiosk:face_required`, `admin:kiosk_error`, `kiosk:scan_error`, `kiosk:session_validate`. Plus `message:new` from `messageController`.

### 3.3 Environment variables (`src/config/env.ts`)

All security-sensitive secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `MEDIA_SIGNING_KEY`, `BIOMETRIC_ENCRYPTION_KEY`) are **required with no default** — the app refuses to boot rather than run with a weak fallback. Good pattern, consistently applied.

Dev-placeholder defaults that must be overridden per real deployment: `ML_SERVICE_URL` (localhost:8001), `STORAGE_DIR`, `API_PUBLIC_URL`, `CLIENT_WEB_URL`/`CLIENT_MOBILE_URL`/`CLIENT_ADMIN_URL`, `MIN_APP_VERSION`/`LATEST_APP_VERSION` (must track real app releases — see §6's note on this being a separate source of truth from the website).

`KIOSK_SHARED_SECRET` is optional but fails closed (kiosk connections rejected) if unset — correct direction for a fail-open-vs-fail-closed choice.

### 3.4 Database models vs. controllers

All 14 Prisma models (`User`, `Item`, `Rental`, `Conversation`, `Message`, `Transaction`, `Verification`, `Locker`, `KioskConfig`, `Notification`, `Feedback`, `AuditLog`, `AppRelease`, `Review`) have real, live controller code reading/writing them. No orphaned tables.

### 3.5 Tests

**Corrected 2026-09-06: there are 6 Jest files, not 4** —
`src/controllers/__tests__/{kioskController,paymentController,rentalController}.test.ts`
plus `src/services/__tests__/storageService.test.ts`,
`src/utils/__tests__/crypto.test.ts` and `src/utils/__tests__/kioskEventLog.test.ts`.
The real-HTTP suites live at **`server/node_server/scripts/e2e-*.mjs`** (10 of
them), not a repo-root `scripts/`. Jest with a fully mocked Prisma client (`jest-mock-extended`). Real assertions, narrow scope: rental status transition whitelist, payment amount derivation, webhook signature check, locker-release ownership check. No coverage for auth, items, messaging, notifications, reviews, feedback, or any of the ~33 admin endpoints — those are exercised only by the manual `scripts/e2e-*.mjs` scripts (real HTTP calls against a live server + real database, run by hand, not part of any CI in this repo).

---

## 4. ML Verification Service — `server/python_server/services/ml`

### 4.1 Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /verify | `X-API-Key` | Full hybrid item-photo comparison → APPROVED/PENDING/RETRY/REJECTED |
| POST | /extract-features | `X-API-Key` | Pre-extracts features for later cached comparison |
| POST | /register-face | `X-API-Key` | Extracts a 128-float dlib face encoding from a selfie |
| POST | /verify-face | `X-API-Key` | Compares a captured face against a stored encoding or reference URL — **this is the endpoint the phone-verification flow now calls, via Node's proxy, never directly** |
| GET | /health | none | Reports which capabilities are actually active (deep learning, OCR, face recognition) |

`require_api_key` is a no-op if `ML_API_KEY` is unset — see Problems §2.

### 4.2 Item comparison algorithm (`app/comparison/hybrid.py`)

Real pipeline, not a placeholder: quality gate (rejects blurry/dark kiosk photos) → pHash pre-filter (fast-rejects obvious mismatches) → traditional CV (color/shape/texture/HOG/ORB) → SIFT+RANSAC → SSIM → optional ResNet50 deep-embedding comparison → optional OCR serial-number match.

Weighted final score: traditional 0.30, deep 0.25, sift 0.20, ssim 0.15, phash 0.10 (redistributed if deep learning disabled), aggregated across all photo pairs by a trimmed mean (drops the weakest 20%/strongest 10% of pairwise scores). A "good pair" sanity check demotes an otherwise-high score if fewer than 2 pairs individually clear the manual-review threshold.

**Decision thresholds**: `confidence ≥ 85` → APPROVED, `60 ≤ confidence < 85` → PENDING (manual review), `< 60` → RETRY (up to 10 attempts) then REJECTED.

### 4.3 Face verification — still present, dual-mode

Not removed from this service — the kiosk stopped calling it, but the phone-verification flow still reaches it (via Node's server-side proxy, so the ML API key never touches the client). Primary path is `face_recognition` (dlib): 128-d encoding, Euclidean distance threshold 0.5 (stricter than dlib's stock 0.6). Fallback path (only if dlib fails to import) is Haar cascade + color-histogram correlation — see Problems §3 for why this matters.

### 4.4 Dependencies

Real, heavy deps in the Docker image: opencv, scikit-image, dlib-bin, face_recognition, torch/torchvision, pytesseract (+ system tesseract-ocr). Only `face_recognition` is import-guarded with a try/except — everything else is a hard dependency once the service starts.

### 4.5 Tests

`tests/test_api_key_gate.py` — 5 focused tests on the auth gate only. Nothing tests the comparison algorithm, thresholds, or the SSRF-hardened reference-image fetch path.

---

## 5. Kiosk — `server/kiosk` (Raspberry Pi 5)

### 5.1 Hardware, as it exists today

4 USB cameras (one per locker interior), mapped via stable `/dev/v4l/by-path/` symlinks (tied to physical USB port, survives reboots — a raw `/dev/videoN` map was tried first and found unstable across reboots). Current mapping, physically re-verified twice the same day (once for a wrong port assignment, once after the face camera's physical removal shifted two lockers onto a different USB controller):

- Locker 1 → `platform-xhci-hcd.0-usb-0:1.2:1.0`
- Locker 2 → `platform-xhci-hcd.0-usb-0:1.3:1.0`
- Locker 3 → `platform-xhci-hcd.0-usb-0:2:1.0`
- Locker 4 → `platform-xhci-hcd.1-usb-0:2:1.0`

GPIO via the RP1 chip: 3× 4-channel + 4× 1-channel relay modules, active-LOW, driving 8 solenoids (main + bottom door × 4 lockers) and 4 linear actuators. Timing is real and hand-calibrated per locker in `kiosk_config.json`, not a shared default (e.g. locker 1: 15/15/22/22s extend/retract/open/close; locker 2: 5/5/21/21s — genuinely different hardware behavior per unit).

**The face camera is gone — fully, not degraded.** `face_service.py` deleted. `camera_manager.py` has no face-capture code path at all. `socket_client.py`'s `capture_face` command handler was replaced with a no-op "wait for the phone" handler. Self-test no longer probes a 5th camera. `config.py` no longer holds an ML service URL or API key — the kiosk doesn't talk to the ML service at all any more; that call now happens entirely inside Node.

### 5.2 Local UI

React/Vite build, served as static files by a small Flask backend (`kiosk_ui/server.py`) on port 8080, with a local Socket.IO channel pushing state to the frontend. Real connection to Node over Tailscale.

**Known dead code, deliberately not removed**: `QrScreen.tsx`/`ConfirmScreen` and the `"qr"`/`"confirm"` states in `useKioskState.ts` supported the kiosk scanning a QR shown on the phone — backwards from how hand-off actually works (the kiosk displays its own code; the phone scans it). The camera-worker thread that fed that reversed flow was deleted along with the face camera it depended on. The screens are commented as vestigial rather than deleted, to bound the size of the 2026-09-03 change.

### 5.3 Autostart

`~/.config/autostart/engirent-browser.desktop` runs a bash loop keeping exactly one Chromium window alive. This bit twice in production this session: `/usr/bin/chromium` is a shell wrapper around `/usr/lib/chromium/chromium`, so a `pgrep` guard matching the wrapper self-matches the supervisor script (blank-screen bug, since the guard is then permanently "true"); a guard matching neither binary never detects a running browser (window-stacking bug, a new window every 10s). Current guard (`^/usr/lib/chromium/chromium.*--app=...`) verified correct from a cold reboot.

---

## 6. Face Verification Architecture (cross-cutting, moved off the kiosk 2026-09-03)

The real, current flow: the kiosk continuously displays its own QR code (`GET /api/qr-token`, format `KIOSK-001:{token_id}:{timestamp}:{signature}`, 90-second TTL, HMAC-signed). The phone scans it and emits `app:kiosk_scan`; Node relays `kiosk:session_validate` to the kiosk's socket room; **the kiosk itself** checks the token — and the check is an identity match, not a signature recomputation: `validate_qr_token_internal` accepts a token only if it is byte-identical to the single token currently live in that process, only inside the 90-second TTL, and it burns the token on use. (Corrected 2026-09-06 during E1; the sha256 suffix is minted but never re-verified. The identity match is the stricter of the two — a correctly-signed token that was never issued is refused, and every token is single-use. Pinned by `server/kiosk/tests/test_qr_token.py`.) That check is the one real moment "a person is standing at this physical kiosk right now" becomes true, and nothing downstream re-derives it from anything the phone claims.

On success the kiosk emits `kiosk:flow_start`. Node then:

1. Resolves who must verify purely from the rental's status (`resolveFaceSubject` — the owner for a deposit, the renter otherwise), never from anything the client sends.
2. Opens a short-lived server-side session (`kioskSessionStore.ts`), keyed by rental ID: which kiosk, which user, a 120-second expiry, an attempt counter. This is the actual trust boundary in the whole system — the `/kiosk/verify-face` endpoint the phone calls never accepts a client-supplied kiosk ID; it only trusts this record.
3. Tells the phone to open its verification page (`kiosk:face_required`) and tells the kiosk to show a plain waiting screen — no camera, since it no longer has one.

The phone captures a selfie and uploads it to `POST /kiosk/verify-face`. Node looks up the session, rejects if the caller isn't the session's own user, calls the ML service **server-side** (so the ML API key never reaches the client), and only then opens a locker — never on a client-asserted result. A bad match returns a retryable failure straight in the HTTP response (capped at 4 attempts per session before forcing a re-scan), deliberately not routed through a socket event so retrying doesn't disturb the screen underneath. There is **no local/weaker fallback** on the Node side if the ML service is unreachable — verification fails closed rather than silently degrading, which is a real change from how the old kiosk-side flow behaved (it used to fall back to a materially weaker local Haar-cascade check with no visible signal that a downgrade had occurred).

All three actions (deposit, claim, return) were unified to **verify first, then open the door** — previously deposit had no face gate at all through the socket path, and return opened the door *before* verifying identity.

---

## 7. Admin Console — `client/admin` (Next.js 15 / React 19 / Mantine 7)

### 7.1 Pages

18 pages under `src/app/`, all confirmed to call real endpoints (not mock-only) once outside dev mode: dashboard, users (list + detail), items (list + detail, with moderation and review deletion), rentals (list + detail with conversation view), disputes (read-only priority queue — see Problems §10), payments (list, refund, payment decisions), verifications (AI condition-check queue), id-verifications, feedback queue, reports, audit-log, kiosk control (per-locker camera/door/actuator controls + timing config + live log stream, 4 locker tabs — no Face Cam tab, removed the same day the hardware was), health/self-test panel, settings (kiosk config editor + a deliberately non-editable late-fee reference table).

Every page shares a `isDemoMode` flag (`NODE_ENV !== "production"` unless explicitly overridden) — in dev, an in-memory adapter serves canned data instead of hitting the real backend; in production this is bypassed entirely.

### 7.2 Auth

Client-side gating is token-presence-only: a root redirect checks for a token in `localStorage`, and a global 401 interceptor redirects back to login. No page checks the token itself, and there is no client-side Reviewer-vs-Admin distinction anywhere — if that split matters in this UI, it currently doesn't show.

### 7.3 Tests

None. No test files, no test tooling installed, no `test` script in `package.json`.

---

## 8. Flutter Mobile App — `client/flutter_app` (v1.8.0+18)

### 8.1 Screens

24 screen files across auth, home, items, kiosk, messages, notifications, onboarding, payments, rentals, reviews, and feedback. Every one makes genuine API or socket calls — no screen found to be stub-only or permanently mocked. Every screen has at least one real caller (no orphaned screen files).

The two kiosk screens are the newest: `kiosk_scan_screen.dart` (QR scan + waiting states, socket-driven) and `face_verify_screen.dart` (the new in-app verification page — front camera, oval framing guide, calls `POST /kiosk/verify-face`).

### 8.2 Demo-mode fallback

`AppConstants.demoMode` (`kDebugMode && USE_DEMO_MODE` default true) is isolated to four service-layer files (`auth_service.dart`, `item_service.dart`, `rental_service.dart`, `notification_service.dart`) and only triggers inside a `catch` block after a real API call has already failed — compiled out entirely in release builds. See Problems §7.

### 8.3 Localization

`en`/`fil`/`ceb` locale files exist and are fully translated against each other — but only 32 keys total, covering auth screens, bottom nav, and the home dashboard's rental section. Everything else (roughly 20 screens) is hardcoded English regardless of language choice. See Problems §4.

### 8.4 Tests

Two real unit tests: an offline-write-queue guard (asserts payment/kiosk writes are structurally refused from an offline queue) and a PII-scrubber (asserts signed media URLs, face/ID photo paths, emails, and phone numbers are redacted from crash logs). No widget or integration tests exist for any of the 24 screens.

---

## 9. Public Website — `client/web`

Real content across home/about/pricing/docs/blog, consistent with the design-mandate's "no fabricated changelog content" rule — the blog is a genuine dated engineering journal, not invented copy. `release.ts`/`changelog.ts`/`pubspec.yaml` all agree on the current release (v1.8.0, buildNumber 18, 2026-09-03, face-verification-moved-to-phone).

Two inaccuracies found and corrected as part of this audit: the `about` page claimed "five cameras" (now four, since the face camera's removal); `config/site.ts`'s GitHub link was a bare, non-functional placeholder (now points at the real repo).

---

## 10. Deployment / Infrastructure State (as of 2026-09-03, end of session)

| Service | Local port | Public tunnel |
|---|---|---|
| Node API | `desktop-gklhcri:5000` | *(rotates on every tunnel restart — read the current value from `startbat-logs/tunnel-*.log` on the host, never from a doc)* |
| Admin console | `desktop-gklhcri:3001` | *(rotates on every tunnel restart — read the current value from `startbat-logs/tunnel-*.log` on the host, never from a doc)* |
| Public web | `desktop-gklhcri:3000` | *(rotates on every tunnel restart — read the current value from `startbat-logs/tunnel-*.log` on the host, never from a doc)* |
| ML service | `desktop-gklhcri:8001` | not tunneled — internal only |
| Kiosk | Raspberry Pi 5, `engirent-kiosk` | reached via Tailscale, no public tunnel (dials out to Node) |

All four PC-hosted services run as Windows Scheduled Tasks under an **Interactive logon type**, which does not survive a reboot without a manual login — a known, accepted operational gap, not automated around.

Cloudflare quick tunnels rotate hostname on every tunnel restart (not on every deploy) — any client with a baked-in URL (the Flutter app, specifically) breaks silently until rebuilt with the current URL via `--dart-define`.

**The server's working tree (`D:\ENG\EngiRent`) is a diverged checkout**, not kept in sync with this git repository via `git pull` — deployment there is a manual file copy over SSH. This git repository is the source of truth for code; the server is a deploy target that has drifted from it.

**Current published app build**: v1.8.0 / buildNumber 18, built with the live tunnel URL baked in via `--dart-define`, signed with the real release keystore. Both independent sources of truth for "what version is current" — the website's static config and the app's own DB-backed update-gate (`AppRelease` table + `LATEST_APP_VERSION` env var) — are in sync as of this deploy; they have drifted apart before and nothing currently prevents that happening again on a future release if only one is updated.

---

## 11. Database State (live, as of 2026-09-03 end of session)

Wiped of all non-admin data on explicit instruction, after confirming the exact deletion order needed given the schema's foreign-key constraints (`Rental`/`Review` don't cascade from `User`, unlike `Item`/`Notification`/`Feedback`, which do). Current state: 1 user (`admin@engirent.edu.ph`), 0 rentals, 0 reviews, 0 items. Any demo or manual testing from here needs fresh registrations.

---

## 12. Documentation Inventory

`docs/planning/`: `00-start-here.md` (original revamp kickoff prompt), `01-audit-prompt.md` (prompt that produced `documentation.md`), `02-design-mandate.md` (the full design directive across all four surfaces), `03-revamp-master.md` (master single-source-of-truth prompt), `04-continue-design-redo.md` (supersedes `00-start-here.md`), `05-feature-build-checklist.md` (unwired-endpoint / enterprise-readiness checklist), `06-must-have-app-features.md` (generic production-readiness checklist + project appendix).

`docs/audit/`: `documentation.md` (670 lines, 2026-08-05, now stale on kiosk/hardware specifics per §2.13 above — the README already flags it as historical), `phase4-audit-report.md` (81 lines, similarly dated).

`memory.md` (repo root) is the actual up-to-date running engineering log — it is more current than either audit doc and was the primary source for §5, §6, §10, and §11 above.
