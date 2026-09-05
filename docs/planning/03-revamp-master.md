# EngiRent Hub — Full Revamp Master Prompt

Single source of truth for the revamp. Give this file, alongside `documentation.md`, to Claude Code. Use `EngiRent_00_START_HERE.md` as the actual chat message to kick things off.

---

## 0. Ground truth

`documentation.md` (audited 2026-08-05) is the single source of truth for what actually exists in this repo today — verified file-by-file, including the uncommitted working-tree changes present at audit time (a kiosk Socket.io auth fix, ML API-key gating, and a rental-status-transition whitelist, all functionally complete but not yet committed). Two other files exist at repo root outside this audit's own scope — `AUDIT.md` and `ENGIRENT_FULL_AUDIT_AND_REVAMP_PROMPT.md` — the output of a prior, separate audit-and-fix pass dated 2026-07-20. Treat `AUDIT.md`'s prose findings as reliable history, but **not** its "applied automatically" status checkboxes — five of them (§15.3 in `documentation.md`) are confirmed stale against the current code. This master prompt already accounts for that reconciliation; don't re-trust `AUDIT.md`'s checklist independently.

## 1. Mission

Take EngiRent Hub from "functionally real but financially and biometrically unsafe" to a secure, complete, and fully-designed system, across all five real components (`client/admin`, `client/flutter_app`, `client/web`, `server/node_server`, `server/kiosk`, `server/python_server/services/ml`):

1. Fix what's insecure — this system currently has a client-controlled payment amount, no real payout mechanism, unencrypted biometric data in a public bucket, and an unauthenticated locker-release endpoint. These are financial and privacy risks, not style issues.
2. Move hosting off Render onto the user's own PC, with Tailscale reaching the PC, the laptop, and the Raspberry Pi kiosk, plus one-command startup tooling and a real components check on both sides.
3. Reconcile the prior audit pass's stale claims against reality.
4. Finish what's half-built or ledger-only (escrow/payout, security deposit, per-category late fees, emergency stop).
5. Resolve the duplicate in-app admin console — the other architectural anomaly, `client/web`'s inclusion as a fourth designed surface, is resolved (in scope, a promotional website, per §3.5 of the design mandate).
6. Completely redo the design across all confirmed surfaces per the design mandate — with the kiosk's real tech stack (Flask + vanilla JS, not React) now correctly accounted for.
7. Fully verify everything actually works, including real test transactions through PayMongo's sandbox.
8. Ship it: commit, push, and leave the README (already partially self-corrected by the prior pass) fully accurate.

Work through the phases below **in order, in one continuous sweep** — don't pause after each phase for review. All three original open questions are now resolved: the duplicate admin console was retired (`client/admin` kept), the Kiosk was migrated to React/Vite, and `client/web`'s design scope is confirmed in scope (see §3.5 of the design mandate). The one still-open item is whether `client/web` also hosts on the PC. Stop for that, anything that turns out to require physical hardware access you don't have, or a Phase 4 audit failure that needs fixing before Phase 5's push. Everything else, keep moving — summarize what changed at the end, not after every phase.

---

## 2. Implementation research — read before touching any code

### Escrow/payout — what PayMongo actually supports, and what's realistic for this project

PayMongo has a real marketplace product ("PayMongo Platforms") with a genuine Payment Splitting API and a Disbursements/Transfers API. But there are two very different integration paths, and picking the wrong one wastes real effort:

- **Platforms (child-account model)** — the platform onboards each item owner as a verified "child merchant" sub-account, with its own KYC/compliance onboarding, and payments split automatically between platform and child account at checkout. This is built for businesses with verified merchant sellers, not individual students. Requiring every student who wants to list an item to complete a merchant KYC onboarding flow is very likely the wrong fit here — both a worse user experience and a heavier compliance lift than this project needs.
- **Disbursements/Transfers (recommended for this project)** — the platform keeps one PayMongo account, collects all payments into it as today, and disburses to a recipient (bank account, GCash, or other e-wallet) via a single-recipient Transfer, triggered programmatically when a rental completes. This matches how the system already conceptually works (ledger rows exist, they just don't move real money) — the fix is making the existing `DEPOSIT_REFUND`/rental-completion payout code paths actually call PayMongo's Transfer/`send_money` endpoint instead of only writing a `COMPLETED` transaction row. This requires collecting each owner's payout destination (bank account or e-wallet) once during profile setup, not a KYC flow.
- Recommendation: build the payout/refund fix on Disbursements/Transfers, not Platforms. Flag Platforms as a future path if this ever becomes a real, non-thesis business with verified merchant owners — not in scope now.

### Biometric data handling — face encodings and ID images

`User.faceEncoding` is currently a plain unencrypted JSON field, and face/ID photos sit in a **public** Supabase bucket served via unsigned URLs. Supabase is being dropped entirely (per the updated hosting plan — all storage moves to the PC), which actually removes the "trust a third-party bucket's access rules" problem, but only if the local replacement is built correctly — a plain exposed static folder on the PC would be exactly as insecure as the public Supabase bucket it's replacing. This is genuinely different from a normal "stale styling" gap and should be treated with the same seriousness as the payment issues, not folded in as a minor item:
- Encrypt `faceEncoding` at rest (field-level encryption — e.g. AES-256-GCM with a key from a proper secrets manager or at minimum a dedicated env var never checked into git — before writing to the JSON column, decrypt only in-memory when comparing).
- **Never serve the local storage directory directly as static files.** Route all image access through the Node API with two access tiers: item/listing photos (not sensitive, meant to be publicly browsable within the app) go through a controlled route that still prevents directory listing/path traversal, while face/ID images and kiosk verification images (sensitive) are served only via short-lived, signed, single-use-or-time-limited tokens generated server-side per request — the same protective effect Supabase's signed URLs gave, just implemented directly rather than relied on from a managed service. A biometric image should never be reachable by guessing or reusing a URL.
- Add an explicit consent capture at profile setup (a clear statement of what biometric data is collected and why, with an affirmative checkbox — not buried in generic terms), and a retention/deletion path (an account-deletion flow that actually purges `faceEncoding` and the associated images from local disk, not just deactivates the account). Philippine data-privacy law (the Data Privacy Act) treats biometric data as sensitive personal information with real handling obligations — this isn't optional hardening, it's closing a real compliance gap, though for anything beyond the technical fixes above (retention periods, breach notification obligations, etc.) that's a question for the university's data protection officer or legal counsel, not something to resolve by writing code alone.

### Emergency stop — real IoT/locker pattern, not just a software command

The current "emergency stop" is a software `lock_all` command dependent on the Pi process and network connection being alive — meaning the one scenario an E-stop most needs to handle (the Pi crashing, or losing network) is exactly when it wouldn't work. The standard pattern for physical safety-critical stops on relay-driven hardware like this is a **hardware-level, normally-closed cutoff** — a physical E-stop button wired in series with the relay/solenoid power rail itself (not through a GPIO command), so that pressing it cuts power to the locks directly regardless of whether the Pi's software is responsive. Software should additionally expose a `kiosk:emergency` event for logging/notification purposes, but the actual stop function must not depend on software execution succeeding. This is a hardware wiring change, not purely a code change — flag it clearly as requiring physical rework, not just a GPIO pin addition in `config.py`.

### Webhook signature enforcement

`verifyWebhookSignature` already implements the correct HMAC-SHA256 check with `crypto.timingSafeEqual` and correctly parses PayMongo's `t=...,te=...` header format — the implementation itself is sound. The only fix needed is removing the `return true` fallback when `PAYMONGO_WEBHOOK_SECRET` is unset, making it fail closed instead — the same fail-closed pattern the kiosk's `KIOSK_SHARED_SECRET` check already correctly uses. Pair this with fixing the route-level `express-validator` chain that currently requires fields a real PayMongo webhook payload doesn't send at the top level (they're nested under `data.attributes`) — both bugs sit on the same code path and should be fixed together.

---

## 3. Phase 0 — Critical security & financial-integrity fixes (do first, non-negotiable)

1. **Client-controlled payment amount.** `createPayment` currently reads `amount` straight from the request body and writes it to both the `Transaction` row and the PayMongo checkout line item with no comparison against the rental's actual `totalPrice`/`securityDeposit`. Derive the charged amount server-side from the rental record; never trust a client-supplied amount for anything that moves money.
2. **Webhook signature + route validation, together** (see §2 research above) — remove the unsigned fallback, fix the `express-validator` field mismatch so the real webhook branch of `confirmPayment` is actually reachable.
3. **`kioskController.releaseLocker` has no ownership/admin check** — despite a route comment claiming "admin or kiosk service," any authenticated student can currently force-release any locker for any rental. Add the check the comment already claims exists.
4. **Biometric data exposure** — per §2: encrypt `faceEncoding` at rest, build a signed-token image-serving route for face/ID/verification images instead of a raw exposed static folder, add consent capture + a real deletion path.
5. **SSRF surface in `/verify-face`'s `reference_image_url` handling** — `urlretrieve` with no allowlist, size cap, or timeout, not gated by the API-key fix that landed on the same endpoint. Add an allowlist (once storage moves local, this should mean only accepting the app's own signed image-serving URLs, never an arbitrary external URL), a size cap, and a timeout.
6. **API key propagation gap** — neither the Flutter app's `/register-face` call nor the kiosk's `/verify-face` call was confirmed to send `X-API-Key`. Once `ML_API_KEY` is genuinely enforced, both are at risk of a silent 401 — and the Flutter side currently treats this as non-fatal, meaning profile completion would silently "succeed" with no face encoding stored. Fix both call sites to send the header, and make the Flutter failure mode loud (block profile completion, don't silently degrade) rather than silent.
7. **Rate limiter gap** — currently in-memory (resets on restart, not shared across instances) and explicitly skips all `/admin/*` routes, meaning admin login itself is unprotected against brute force. Move to a shared store (Redis, or at minimum a persistent store appropriate for the deployment) and stop excluding admin routes.
8. **Reconcile `AUDIT.md`'s five stale "applied automatically" claims** (documentation.md §15.3) — these are concrete, already-diagnosed gaps, not new investigation needed:
   - `mlFeatures` is not actually nulled out when an item's `images` change in `updateItem` — fix it for real this time.
   - `persistMlFeatures` still exists and still writes the verification-result shape into `Item.mlFeatures` — the prior claim that it was removed was false; decide whether it should actually be removed or was mis-diagnosed as dead code, and act accordingly.
   - The claimed `@@index([status, endDate])` on `Rental` doesn't exist — only a single-column `@@index([status])` does. Add the composite index for real if the query patterns justify it.
   - The stale `actuator_speed_percent` field in `DEFAULT_LOCKER_CONFIG` (`adminController.ts`) was claimed removed and isn't — remove it for real, or confirm it's actually used before removing.
   - Late fee is still a hardcoded flat `LATE_FEE_RATE_PER_DAY = 50` despite a prior claim it was derived from item/rental rate — this now also overlaps with Phase 2's per-category late fee work; fix once, there.

---

## 3.5 Phase 0.5 — Hosting migration & startup tooling

New requirement. Do this after Phase 0's code-level fixes, before Phase 1.

**What's moving:** per `render.yaml`, four services currently deploy to Render — `engirent-api` (Node), `engirent-admin` (Next.js), `engirent-web` (Next.js), `engirent-ml` (Docker/FastAPI). The user is moving to self-hosting on a dedicated PC (Tailscale device name `desktop-gklhcri`). **Confirmed in scope: the Node API (`server/node_server`), the Admin console (`client/admin`), and the Python ML service (`server/python_server/services/ml`).** The Kiosk's own software (`server/kiosk`) stays physically on the Raspberry Pi — that's a hardware requirement, GPIO/camera control has to run on the machine actually wired to the solenoids — but the Pi now connects to the PC-hosted Node API/ML service instead of Render's cloud URLs.

**Confirmed by the user, no longer open questions:**
- **MySQL moves to the PC too** — self-hosted alongside the Node API, not left on whatever external provider currently hosts it.
- **Supabase is dropped entirely** — all image storage (item listings, kiosk deposit/return verification images, face/ID photos) moves to the PC's local filesystem instead. See the dedicated storage-migration section below — this is a bigger change than just swapping a hosting provider, and needs to be done carefully given Phase 0's biometric-security work depends on it being done right.

**Still open — ask the user:**
- Whether `client/web` also moves to the PC for hosting, or stays wherever it currently is (or gets retired). This is a hosting-location question, separate from — and not resolved by — its design scope being settled (it's in scope for the design pass, per §3.5 of the design mandate); still needs an answer.

**Storage migration — Supabase → local filesystem on the PC, with real folder structure:**

Don't just dump every image into one flat directory — that's how you end up with the exact same "everything's public and unstructured" problem Supabase's public bucket had, just self-hosted instead of managed. Structure storage by data type and sensitivity:

```
storage/
├── items/{itemId}/listing-{n}.jpg          — item listing photos (not sensitive, publicly browsable within the app)
├── verifications/{rentalId}/deposit/{n}.jpg — kiosk deposit-stage images
├── verifications/{rentalId}/return/{n}.jpg  — kiosk return-stage images
└── users/{userId}/
    ├── face.jpg                             — biometric, sensitive
    └── id.jpg                               — biometric, sensitive
```

- **Item listing photos**: served through a Node API route (not a raw static-file mount) so directory listing and path traversal stay controlled, even though the content itself isn't sensitive — browsing an item shouldn't require a signed token, but it also shouldn't mean exposing the raw filesystem.
- **Verification and biometric images**: served only via the short-lived signed-token mechanism from §2/Phase 0 item 4 — never a permanent or guessable URL.
- **Rewire every current Supabase call site to hit local storage instead**, not just the config: `server/node_server/src/services/storageService.ts` (currently calls the Supabase REST API directly via axios), the `/upload/image` and `/upload/images` routes, and — importantly — `server/kiosk/services/image_uploader.py`, which currently uploads **directly** from the Pi to Supabase, bypassing the Node API entirely. Once storage lives on the PC's local disk, the kiosk can no longer write to it directly (the Pi and the PC are different physical machines, connected over Tailscale, not a shared filesystem) — rewire `image_uploader.py` to `POST` images to a Node API upload endpoint instead, over the same Tailscale connection used for everything else, rather than attempting a network filesystem mount (much simpler and more secure than trying to share a filesystem between two machines).
- Remove `@supabase/supabase-js` and the `supabase` Python package from both services' dependencies once nothing calls them anymore — don't leave dead SDK dependencies behind (this overlaps with, and supersedes, the dependency-cleanup item already in Phase 1).

**Remote administration — Tailscale:**
- Add the PC (`desktop-gklhcri`, already online per the user's Tailscale admin console) and the Raspberry Pi kiosk to the same tailnet as the laptop, so Claude Code — running from the laptop — can reach both the PC and the Pi directly to run commands and verify things live, the same purpose this served for the sibling Road Sentinel project.
- **The laptop's Tailscale connection is showing expired again** (per the user's screenshot, "Expired Aug 2, 2026") — re-authenticate it first (`tailscale up`, sign back in), same as before. This is a recurring thing worth the user setting a calendar reminder for, not something to solve in code.
- Confirm which OS the PC and Pi actually run before writing any autorun/service scripts (per the Tailscale admin console, the PC is Windows — `desktop-gklhcri`; the Pi is Linux, as it always has been for GPIO/camera control) — **don't write Windows-style tooling for the Pi or vice versa**, see the two deliverables below.

**Deliverable 1 — `Start.bat` (or a small compiled executable) on the PC, Windows:** a single script/executable that launches the full self-hosted stack at once — the Node API, the Python ML service (with its virtualenv activated), and the Admin console — rather than the user needing to open three terminals manually. Before declaring the stack "ready," it should run the Components Check described below and report pass/fail per service, not just launch everything blind and hope.

**Deliverable 2 — Raspberry Pi autorun setup: `setup.sh`, not `setup.bat`.** The Pi runs Linux, not Windows — `.bat` files don't execute there. Build this as a bash script (`setup.sh`) that installs dependencies and registers the kiosk software as a systemd service (or services, if the local Flask UI and the main asyncio controller are best run as two separate units) with `systemctl enable`, so the kiosk comes back up on its own after a normal reboot — matching the same Windows-vs-Linux distinction already established for Road Sentinel's equivalent setup. Include the WiFi captive-portal provisioning flow (`server/kiosk/provisioning/`) as part of first-boot setup, since that's already real, working code.

**Components Check — new requirement, both sides:**
- **Software side (PC, part of `Start.bat`):** before declaring the stack ready, verify — local MySQL is running and reachable, the local storage directory structure exists with correct permissions, the ML service's `/health` endpoint responds, PayMongo's API is reachable (or at minimum that the configured keys are present and non-placeholder), the Node API's own `/health` endpoint responds, and the Admin console builds/starts without error. Report each check's pass/fail clearly rather than silently continuing on a failure.
- **Hardware side (Pi, part of kiosk startup):** a real self-test mode alongside the existing `MOCK_GPIO`/`MOCK_CAMERA` simulation toggles already in `config.py` — verify all 8 solenoids and 4 actuators respond to a test pulse, all 4 locker cameras successfully open a frame (the 5th, face camera was physically removed 2026-09-03), the touchscreen display initializes, and Tailscale connectivity to the PC is confirmed, before the kiosk UI reports itself ready for use. This is a natural extension of infrastructure that's already there (the mock-mode toggles), not something built from scratch.
- **Surface all of this through the Admin Console — don't leave it as command-line-only output.** Before building any new plumbing for this, audit what already exists: `client/admin` already has a `kiosk` page (per `documentation.md §3`), and the API already has real kiosk-telemetry infrastructure — `GET /admin/kiosks/events` (an SSE stream of live kiosk telemetry), `GET /admin/kiosks` (distinct kiosk IDs), `GET/PUT /admin/kiosks/:kioskId/config`, and `POST /admin/kiosks/:kioskId/command` (arbitrary hardware command, already wired). Build on this rather than inventing a parallel channel:
  - Add a `self_test` command type to the existing `/admin/kiosks/:kioskId/command` endpoint, so an admin can trigger the Pi-side hardware self-test remotely from the console rather than needing physical/SSH access to the Pi for every check.
  - Stream self-test results back through the existing `/admin/kiosks/events` SSE channel, extending its telemetry shape rather than building a second real-time channel.
  - Add a genuine **Health Check page** to the admin console (extending the existing `kiosk` page, or as a new dedicated page if the existing one doesn't fit — check what's actually on it first) that surfaces both sides in one place: the PC-side software components check (MySQL, storage, ML service, PayMongo, Node API, Admin build) and live per-Pi hardware status (solenoids/actuators/cameras/touchscreen/Tailscale), using the severity colors already defined in the design mandate's palette (success/warning/critical) so a failing component is visually unambiguous at a glance.
  - This becomes the authoritative "is everything actually working" view for the whole system — treat it as a first-class admin feature, not a debug afterthought.
- Feed both checks into Phase 4's audit explicitly — a "Components Check" pass/fail should be part of that phase's verification, and Phase 4 should specifically confirm the new admin Health Check page genuinely reflects real system state, not just that the checks run somewhere.
- **Record this decision in the repo's own `memory.md`** (the cross-session log already created) — the admin-integrated Health Check approach, and the decision to extend existing kiosk-telemetry infrastructure rather than build parallel systems, so a future session picking this back up doesn't rediscover or re-litigate it.

---

## 4. Phase 1 — Functionality correctness pass

- **Schema drift.** `server/node_server/schema.sql` is a stale, hand-written DDL dump, confirmed drifted from `schema.prisma` in at least five ways. `schema.prisma` is authoritative — regenerate `schema.sql` from it (or delete the static file and replace with a real export script) so nothing provisions a database from the stale version.
- **Dead `RentalStatus` enum values.** `AWAITING_CLAIM` and `AWAITING_RETURN` are declared but no code path ever assigns either — the real flow goes `DEPOSITED`→`ACTIVE` directly with no intermediate return-pending state. Either wire a real intermediate state into the flow (if there's a genuine need for one — e.g. a window between "item AI-verified as returned" and "admin/system finalizes completion") or remove the unused enum values. Don't leave them as silent dead schema.
- **ML face-verification fallback should not fail silently.** The kiosk's local Haar-cascade heuristic fallback (on ML-service outage) is a materially weaker check than the real dlib comparison, and currently substitutes with no signal to the user or admin that a weaker check ran. Surface this — at minimum a flag on the resulting `Verification`/session record, ideally a visible (if brief) notice in the kiosk UI and a corresponding admin-console indicator, so a security-relevant degradation isn't invisible.
- **Kiosk UI missing an "AI verification in progress" state.** Item-photo verification runs entirely server-side after `kiosk:images` is received, but the kiosk UI's seven states (`IDLE, MAIN, QR, CONFIRM, FACE, SUCCESS, ERROR`) have no state reflecting this multi-second wait, and the inactivity timer isn't suspended for it. Add a dedicated waiting state, and suspend the timeout while it's active — a user shouldn't get kicked back to idle mid-verification.
- **Config cleanup — stop declaring what isn't real.** `KIOSK_RASPBERRY_PI_URL` and `KIOSK_WEBHOOK_SECRET` are declared but never read outside `env.ts` — remove or wire them. `MAX_FILE_SIZE`/`ALLOWED_FILE_TYPES` are declared but ignored (`middleware/upload.ts` hardcodes its own 10MB limit and MIME allowlist) — make the env vars actually control this, or remove them so the config surface stops lying about what's configurable.
- **Dependency cleanup.** Remove `@supabase/supabase-js` from `node_server` (deliberately unused — the code calls the REST API directly by design, but the dependency itself should go if truly never imported). Remove `gpiozero` from the kiosk's dependency awareness (already fully migrated to direct `lgpio` calls). Remove or actually use the ~17 zero-import Flutter dependencies (`get_it`, `go_router`, `flutter_form_builder`, `form_builder_validators`, `badges`, `shimmer`, `dotted_border`, `qr_flutter`, `app_links`, `permission_handler`, `connectivity_plus`, `flutter_spinkit`, `pdf`, `printing`, `csv`, `url_launcher`, `google_fonts`, `flutter_svg`) — for each, either wire it in for real or drop it from `pubspec.yaml`.
- **Confirm demo-mode fallbacks are genuinely disabled in production.** Both the Flutter app's `AppConstants.demoMode` and the admin console's `isDemoMode` axios adapter substitute fake data silently on network errors. Verify the real production build config actually disables both — a silent fake-data fallback in production would be a serious, hard-to-notice bug (dashboards/screens looking fine while showing fabricated data).
- **Test infrastructure — currently completely absent.** `node_server`'s `package.json` declares a `jest` test script with no `jest` package installed; the ML service has `pytest` in `requirements.txt` but zero tests written. Stand up real test infrastructure for both, prioritizing coverage of Phase 0's fixes first (payment amount derivation, webhook validation, locker-release auth, the ML API-key gate) so the security fixes don't silently regress later.
- **Flutter app's hardcoded API base URL.** `app_constants.dart:5` hardcodes `https://engirent-api.onrender.com/api/v1`, unlike both Next.js apps which are env-configurable. Make this build-configurable (dev/staging/prod) rather than hardcoded.

---

## 5. Phase 2 — Feature completion

- **Real escrow/payout**, per §2's PayMongo Disbursements research — collect each owner's payout destination during profile setup, and make rental completion trigger a real Transfer instead of only writing a `COMPLETED` transaction row.
- **Real security deposit collection + refund** — currently `confirmPayment` advances a rental on *either* a `RENTAL_PAYMENT` or `SECURITY_DEPOSIT` transaction completing, not both, and no `DEPOSIT_REFUND` transaction is ever actually created or paid out on completion. Fix both: require both payments to genuinely gate progression where the flow calls for a deposit, and make deposit refund a real Transfer (same mechanism as the payout fix above), not a ledger row.
- **Damage fees should move real money, or be clearly labeled as not doing so yet.** `settleDispute` currently creates a `DAMAGE_FEE` row with `status: COMPLETED` but no held-deposit pool to draw from and no real charge collected. Given the security deposit is being made real in this same phase, damage fees can now legitimately draw from that held deposit — wire this properly rather than leaving it ledger-only.
- **Per-category late fees.** Currently a hardcoded flat ₱50/day, ignoring the per-category rates `ITEM_CATEGORIES.md` itself suggests. Derive the rate from the item's category/rental rate per that reference doc, and make the resulting charge a real transaction, not ledger-only (tie into the payout/deposit work above rather than solving late fees in isolation).
- **Emergency stop — hardware fix**, per §2's research. Flag clearly to the user that this requires physical wiring changes on the actual kiosk hardware, not just a software/GPIO change — this may be out of scope for Claude Code to complete unattended, similar to how Road Sentinel's crash-model training was flagged as a physical/out-of-band task.
- **The duplicate admin console — resolved.** A second, fully independent ~1300-line admin console lived inside the Flutter app (`admin_home_screen.dart`), duplicating `client/admin`'s functionality against the same API with untyped `Map<String,dynamic>` data instead of typed models. Decision made: retired the in-app Flutter admin module entirely, `client/admin` is the fuller-featured, typed, purpose-built surface going forward.
- **`client/web` — scope resolved, was previously open.** It's a real, EngiRent-branded fourth surface (accurate homepage copy, a real `/docs` with four genuinely accurate sections, EngiRent-specific pricing tiers, thesis-relevant blog posts) — not boilerplate. Confirmed in scope for its own full design pass, built fresh from the Velora UI template per §3.5 of the design mandate, not left as-is. The two small unmodified scaffold leftovers (`components/counter.tsx`, `package.json`'s `"name": "next-app-template"`) get cleaned up as part of that rebuild, not separately.
- **In-app chat — confirm scope with the user.** Mentioned in older docs, confirmed absent from the actual code (`client/`/`server/`, repo-wide). Ask whether this is still wanted as a real feature before building it, rather than assuming it's still in scope just because an old doc mentioned it.

---

## 6. Phase 3 — Complete design overhaul

Reference `EngiRent_02_DESIGN_MANDATE.md` in full — it's a mandatory full scrap-and-remake, not incremental restyling, with an enforced screenshot-verify loop and a `DESIGN.md` deliverable. One thing already resolved, and two decisions confirmed in scope:

- **The Kiosk's framework question is resolved: option (a).** It was migrated from Flask + vanilla JS to a React/Vite build, served locally the same way the Flask static assets used to be — so it now shares the same animation stack (Framer Motion, react-bits, Lottie) as the other surfaces. Flask remains the backend/hardware-control layer; only the frontend moved. This migration itself was reported complete and screenshot-verified — but per §0 of the updated design mandate, re-verify that against a real running instance before trusting it, given the same claim turned out to be false for the Admin Console.
- **`client/web` is confirmed in scope for this phase** — build it fresh per §3.5 of the design mandate, using Velora UI as the starting template. Include it in this phase's screenshot-verify loop explicitly, same as the other three surfaces.
- **The two independently-versioned HeroUI installs** (`client/admin`'s meta-package + React 19, `client/web`'s à-la-carte packages + React 18) are both resolved, differently: `client/admin` moves to Mantine per the design mandate. `client/web` moves off HeroUI too, but onto Velora UI's shadcn/ui-based stack instead of Mantine — a deliberate exception, since `client/web` doesn't share components with the app surfaces and using a second component system there doesn't create the inconsistency it would elsewhere.

Everything else in the design mandate — the four-surface template references, the "EngiRent Vault" palette, the kiosk attract-loop pattern, the mandatory `DESIGN.md` + screenshot-verify loop — applies exactly as written.

---

## 7. Phase 4 — Full functional audit & verification

Live verification, not another code read-through.

- **API audit** — call every real endpoint from §6 of `documentation.md` for real, confirm auth is enforced where the table says it should be, and specifically re-verify the Phase 0 fixes: attempt a client-controlled payment amount and confirm it's now rejected/overridden server-side; attempt a locker release as a non-owner student and confirm it's now blocked; send a malformed webhook and confirm signature enforcement now fails closed.
- **Real payment/payout verification** — using PayMongo's sandbox/test mode, run an actual rental through checkout → completion → payout, and confirm a real Transfer fires (not just a `COMPLETED` transaction row) and a real deposit refund fires on a completed rental. This is the single most important check in this phase — the whole point of Phase 2's payout work is that this now actually moves test money, not just satisfies a code review.
- **Biometric storage verification** — confirm `faceEncoding` is genuinely encrypted at rest (inspect the raw DB value, not just the code path), and confirm face/ID image URLs are now signed and time-limited rather than permanently public.
- **Hardware verification** (if the user has live access to the physical kiosk — flag this as conditional on that access being available, same pattern as Road Sentinel's Tailscale-gated hardware checks) — confirm the new "AI verification in progress" kiosk state actually appears and suspends the timeout correctly; confirm the emergency-stop hardware change (if completed) actually cuts power independent of the Pi's software state.
- **Design verification** — this is where `DESIGN.md`'s mandatory screenshot-compare-refine loop gets its final check: confirm every surface in scope has before/after screenshots in `DESIGN.md` and that they genuinely match the design mandate's spec, not just "looks different from before."
- **Test infrastructure verification** — confirm the Phase 1 test suite actually runs in CI (or at minimum locally) and genuinely covers the Phase 0 security fixes, not just scaffolding with no real assertions.

Produce a short audit report (pass/fail per item above) before Phase 5. Fix and re-verify anything that fails — don't ship on a failed audit.

---

## 8. Phase 5 — Commit, push, and final documentation

- Commit in logically-grouped commits (one per phase or major fix), not one giant commit.
- Push to `origin/main` only after Phase 4's audit passes cleanly.
- **Reconcile the two untracked root-level files** (`AUDIT.md`, `ENGIRENT_FULL_AUDIT_AND_REVAMP_PROMPT.md`) — ask the user whether to keep them as historical record (perhaps moved into a `docs/history/` folder so they're clearly not current), or remove them now that `documentation.md` and this master prompt supersede them. Don't silently delete prior work without asking.
- **Final README pass** — the current README already carries an accurate self-correction banner from the prior audit pass (verified accurate in `documentation.md` §15.1); this pass should integrate that corrected information into the README's main body properly rather than leaving it as a bolted-on banner, and add whatever's new from this revamp (real payouts, real security-deposit handling, the redone design across all surfaces, the resolved admin-console duplication).
- Confirm the already-staged deletions (`AI_SYSTEM_DOCUMENTATION.pdf`, `Engirentpre2.apk`, 73MB) actually get committed as deletions, and that `.gitignore` continues to prevent recurrence.

---

## 9. Ground rules for the whole revamp

- Read §2 (Implementation research) before starting Phase 0.
- Work through all seven phases in one continuous sweep — don't pause for review between phases. Only stop for the three flagged open questions, a genuine physical-access blocker, or a failed Phase 4 audit.
- The duplicate admin console and the Kiosk's framework are both resolved (retired the Flutter admin module; Kiosk migrated to React/Vite). The one remaining thing not to decide silently: whether `client/web` hosts on the PC.
- Treat `AUDIT.md`'s status checkboxes as unreliable; treat its prose findings and this document's own findings as the real basis for work.
- The emergency-stop hardware fix may be outside what Claude Code can complete unattended (physical wiring) — flag it clearly rather than attempting to fake a software-only substitute and calling it done.
- Never push to `origin/main` with a failing or unverified Phase 4 audit — fix and re-verify first.
- Biometric data and payment-amount fixes are the two highest-severity items in this entire revamp — don't let design work (however extensive) become a distraction from finishing those first.