# EngiRent Hub Audit — 2026-07-20

> Scope: full repository audit per `ENGIRENT_FULL_AUDIT_AND_REVAMP_PROMPT.md`, sections 0–12.
> Method: read the real code in `client/` and `server/` and reconciled it against the six
> project docs (README, AI_SYSTEM_DOCUMENTATION, AI_VERIFICATION_GUIDE, EngiRent_Hub_Analysis,
> ITEM_CATEGORIES, analyzation). Every finding below is grounded in a specific file/line, not the docs.
>
> **Gating (prompt §0):** findings tagged **[GATED — BIOMETRIC]**, **[GATED — PAYMENT]**, or
> **[GATED — HARDWARE]** are NOT auto-fixed. They are documented here and surfaced at the end for
> your review before any change. Everything else is fixed under full-sweep authorization.

## Summary

**7 Critical · 9 High · 12 Medium · 6 Low**

| # | Severity | Title | Gated? |
|---|---|---|---|
| C1 | Critical | Unauthenticated socket events open physical lockers (`kiosk:face` spoof) | HARDWARE |
| C2 | Critical | Unauthenticated socket events drive verification, payment-release & rental completion (`kiosk:images` spoof) | HARDWARE + PAYMENT |
| C3 | Critical | Payment amount is fully client-controlled (`createPayment`) | PAYMENT |
| C4 | Critical | No real escrow: funds never held-for-owner, never released, never paid out | PAYMENT |
| C5 | Critical | Raw face photos, ID-card images & face captures stored in a **public** Supabase bucket | BIOMETRIC |
| C6 | Critical | `faceEncoding` (biometric template) stored unencrypted; README claims "encrypted face data" | BIOMETRIC |
| C7 | Critical | ML service `/verify`, `/verify-face`, `/register-face` have **no authentication** | HARDWARE-adjacent |
| H1 | High | Security deposit is never actually collected or refunded; damage fees are ledger-only | PAYMENT |
| H2 | High | No biometric consent flow; no retention/deletion; no account-deletion (RA 10173) | BIOMETRIC |
| H3 | High | Flutter payment flow calls backend endpoints that don't exist — payment is broken E2E | no |
| H4 | High | Emergency-stop (GPIO 23) not implemented; `lock_all` is software-only, no physical fail-safe | HARDWARE |
| H5 | High | Face-verification has no fallback and no lockout/unlock path (design gap) | no |
| H6 | High | 1-hour unclaimed auto-move rule & conveyor recovery: documented, not implemented | no |
| H7 | High | Kiosk UI has no "verifying — do not leave" state; idle-timeout not suspended during verification | no |
| H8 | High | ML feature cache never invalidated when an owner replaces listing photos | no |
| H9 | High | `persistMlFeatures` stores the verification *result* into `Item.mlFeatures`, not features | no |
| M1 | Medium | Rate limiter is in-memory (resets on restart, not multi-instance) and skips all `/admin` | no |
| M2 | Medium | Stale hardware config: `actuator_speed_percent` + trapdoor pins in seed/defaults | no |
| M3 | Medium | Late fee hardcoded flat ₱50/day, ignores per-item rates | no |
| M4 | Medium | README structure/stack is wildly out of date (YOLOv8, GCash, AWS, `apps/`, "React kiosk") | no |
| M5 | Medium | Three docs still describe YOLOv8 + GCash, which the system does not use | no |
| M6 | Medium | `Engirentpre2.apk` (73 MB) + `AI_SYSTEM_DOCUMENTATION.pdf` (723 KB) committed to git | no |
| M7 | Medium | README clone URL is a placeholder (`your-username/engirent-hub`) | no |
| M8 | Medium | Kiosk `.env.example` uses a stale/wrong Supabase project ref | no |
| M9 | Medium | ML service CORS is `allow_origins=["*"]` | no |
| M10 | Medium | Deployment docs (AWS EC2/Nginx/Certbot) contradict the real target (Render.com) | no |
| M11 | Medium | `updateRentalStatus` lets any participant force arbitrary status transitions | no |
| M12 | Medium | ID-card image is collected but never verified against student identity | no |
| L1 | Low | GitHub "44.1% Makefile" language stat — no Makefiles tracked; likely binary miscount | no |
| L2 | Low | `favicon.ico` committed at repo root | no |
| L3 | Low | No index on `Rental.endDate` (late-fee cron does a filtered scan) | no |
| L4 | Low | AI-verification end-to-end latency unmeasured (ResNet50 on CPU + 7 stages) | no |
| L5 | Low | Kiosk scan screen QR / kiosk terminal feature (§7) not started | no |
| L6 | Low | `get_it`, `dio`, `go_router` installed in Flutter but unused | no |

---

## Section 1 — Documented vs. actual structure

**Confirmed real structure** (this is the ground truth to standardise on):

```
EngiRent/
├── client/
│   ├── admin/         Next.js 15 admin console (port 3001)
│   ├── web/           Next.js 15 public site (port 3000)
│   └── flutter_app/   Flutter mobile app
└── server/
    ├── node_server/   Node/Express + Prisma/MySQL API (port 5000)  ← entry: src/index.ts
    ├── python_server/services/ml/   FastAPI 8-stage verifier (port 8001)
    └── kiosk/         Raspberry Pi 5 controller (Python, Flask UI + Socket.io client)
```

### [Medium] M4 — README describes a structure and stack that does not exist
- **Where:** `README.md` (Project Structure, Tech Stack, Architecture, Deployment sections)
- **What's wrong:** README documents `apps/mobile`, `apps/web`, `apps/kiosk`, `backend/`, `ml-service/`, `hardware/raspberry-pi`, `hardware/esp32`, `docker/`, `tests/`, `.github/workflows/` — none of which exist. It lists **YOLOv8** as the ML model (it's an 8-stage hybrid CV pipeline, explicitly *not* YOLOv8 per `AI_SYSTEM_DOCUMENTATION.md`), **GCash API/Xendit** for payments (it's PayMongo), **AWS S3** for storage (it's Supabase Storage), **MySQL local + MQTT + ESP32** hardware (the real kiosk drives GPIO relays directly from a Pi 5 via `lgpio`; there is no ESP32 and no MQTT in the codebase), and a **React kiosk touchscreen** (the real kiosk UI is Flask + vanilla JS in `server/kiosk/kiosk_ui/`).
- **Fix:** [applied automatically] Rewrite README structure/stack/architecture/deployment sections to match reality; keep the problem statement, survey data, and team sections which are still accurate.

### [Medium] M10 — Deployment documentation contradicts the real target
- **Where:** `README.md` (Deployment → AWS EC2 + Nginx + Certbot + docker-compose.prod.yml) vs `render.yaml`
- **What's wrong:** README's entire deployment section describes AWS EC2 with Nginx/Certbot; the actual deploy is `render.yaml` (4 Render.com services in Singapore), confirmed by `analyzation.md`. A reader can't tell which is real.
- **Fix:** [applied automatically] Replace README deployment section with the Render.com reality; note AWS as "not used."

---

## Section 2 — Functional completeness

| Feature | Status | Evidence |
|---|---|---|
| Auth (register/login/refresh/logout) | **Done** | `authController.ts`, JWT + bcrypt, refresh-token rotation stored in DB |
| Profile completion (face + ID capture) | **Partial** | `completeProfile()` stores `profileImage`, `idImageUrl`, `faceEncoding`; but ID never verified (M12), face storage insecure (C5/C6) |
| Item listing/browse/search | **Done** | `itemController.ts` full CRUD + filters + pagination |
| Rental request workflow | **Done** | `rentalController.ts` create → status transitions |
| GCash escrow payment | **Drifted/Broken** | Real gateway is PayMongo; app calls non-existent endpoints (H3); no true escrow (C4/H1) |
| Dual biometric (QR + face) gate | **Partial** | QR session tokens (`kiosk_ui/server.py`) + face (`face_service.py`) exist, but the face gate is spoofable at the socket layer (C1) and has no fallback (H5) |
| AI item verification (deposit + return) | **Done (wired both checkpoints)** | `index.ts` `kiosk:images` handler runs `runMlVerification` for `AWAITING_DEPOSIT` and `ACTIVE`; ML pipeline is real and complete |
| Escrow release only after verification | **Missing** | No payout mechanism exists at all (C4) |
| 1-hour auto-conveyor-to-storage | **Missing** | No cron/timer implements it; no conveyor in hardware (H6) |
| Late-fee automation | **Partial** | `index.ts` daily cron charges ₱50/day flat (M3); ledger-only, no real charge |
| Rating system | **Done (bidirectional)** | `reviewController.ts` — both renter→owner and owner→renter, `reviewType` ITEM/USER; resolves prompt §3.7 |
| Damage compensation | **Partial** | `settleDispute` creates a `DAMAGE_FEE` ledger row but moves no money and has no held deposit to draw from (H1) |
| Admin console (users/items/rentals/verifications/reports/kiosk) | **Done** | `adminController.ts` + admin Next.js pages |
| In-app chat (README/EngiRent_Hub_Analysis) | **Missing** | No chat code anywhere in `server/` or `client/` |
| Notifications | **Done (in-app + email)** | socket + `notification` rows + SMTP emails; push/FCM intentionally excluded per project decision |

---

## Section 3 — Rental lifecycle / business logic

### [High] H1 — Security deposit is never collected or refunded; damage fees draw from nothing  **[GATED — PAYMENT]**
- **Where:** `paymentController.ts:301-308` (`confirmPayment`), `index.ts:159-218` (`completeRental`), `adminController.ts:608-689` (`settleDispute`)
- **What's wrong:** `confirmPayment` advances the rental to `AWAITING_DEPOSIT` when *either* a `RENTAL_PAYMENT` **or** a `SECURITY_DEPOSIT` transaction completes — so nothing forces the security deposit to actually be paid. On completion, the notification says "security deposit refund is being processed" but **no `DEPOSIT_REFUND` transaction is created** and no money moves. `settleDispute` records a `DAMAGE_FEE` row with `status: COMPLETED` but performs no PayMongo charge and has no held deposit pool to draw from. This is exactly the funding-source gap flagged in prompt §3.1–3.2, now confirmed in code.
- **Fix:** [needs your input] Requires a real escrow/deposit design decision (hold deposit at booking, release/refund on completion, charge damage against held funds or via a real PayMongo charge). Gated.

### [Info] §3.4 Retry exhaustion — correctly implemented
- `index.ts` deposit flow: `REJECTED` → rental `CANCELLED` + locker freed + renter notified. Return flow: `REJECTED` → rental `DISPUTED` (renter still holds item) + admin review. Matches `AI_SYSTEM_DOCUMENTATION.md`. No change needed.

### [Medium] §3.5 Dispute SLA — no time-bound escalation
- **Where:** `adminController.ts` (`listVerifications`, `settleDispute`), `Rental.status = DISPUTED`
- **What's wrong:** Cases can sit in `MANUAL_REVIEW`/`DISPUTED` indefinitely; there is no cron or deadline that escalates or auto-resolves. Infrastructure to track exists; a timer does not.
- **Fix:** [applied automatically — additive] Add a lightweight SLA note surfaced in the admin queue (age of case) and document the intended manual SLA. (No money logic touched, so not gated.)

### [High] H5 — Facial-recognition failure has no fallback and no unlock path
- **Where:** `server/kiosk/services/socket_client.py:385-419` (`_cmd_capture_face`), `index.ts:751-854` (`kiosk:face`)
- **What's wrong:** On repeated face-match failure the kiosk retries `capture_attempts` (default 3) then emits `verified:false`; the server emits `face:failed` and the flow simply dead-ends. There is **no** PIN/QR-only fallback, **no** staff override, and **no** documented unlock — a legitimate student who fails face-match (lighting, mask, haircut, camera fault) cannot complete their transaction. (Note: the docs' "lock account after 3 tries" is *not* actually implemented — but the absence of any fallback is the real problem, per prompt §3.6.)
- **Fix:** [needs your input on policy] Recommend adding a secondary verification path (e.g. QR + one-time PIN) and an admin-mediated unlock. The kiosk screen for it is designed in §12. Flagging because it changes the identity-gate behaviour.

### [Info] §3.7 rating directionality — resolved
- Bidirectional reviews are implemented (`reviewController.ts`), contrary to the doc's concern. No change needed.

### Open items to raise with the team (not code-verifiable): §3.3 non-return/theft escalation (no academic-hold hook), §3.8 demand contention on popular items (no queue/waitlist), §3.9 kiosk-full handling (no capacity screen), §3.10 retrieving from delayed-pickup storage (no such state — there is no conveyor).

---

## Section 4 — Biometric data & privacy  **[GATED — BIOMETRIC]**

### [Critical] C5 — Face photos, ID-card images, and face captures are stored in a PUBLIC bucket
- **Where:** `storageService.ts` (`FOLDERS.PROFILES`, `FOLDERS.KIOSK`), `server/kiosk/services/image_uploader.py` (`face-captures/`, `get_public_url`), Supabase bucket `media` (public, per project config)
- **What's wrong:** Registration selfies (`profile-images/`), school-ID photos, and live kiosk face captures (`face-captures/{uuid}.jpg`) are uploaded to the **public** `media` bucket and served via `…/object/public/media/…` URLs. Anyone with (or guessing) a URL can retrieve a student's face and ID. This is sensitive personal + biometric data under RA 10173.
- **Fix:** [needs your input] Move biometric/ID assets to a private bucket with signed, short-TTL URLs (or a separate access-controlled store). Gated — do not change capture/storage silently.

### [Critical] C6 — Biometric template stored unencrypted; README claims otherwise
- **Where:** `schema.prisma` `User.faceEncoding Json?`, `authController.ts:completeProfile`, `README.md` ("🔒 encrypted face data storage")
- **What's wrong:** The 128-float dlib face embedding is written to `User.faceEncoding` as plain JSON with no encryption at rest, and the raw face image URL sits beside it. README advertises "encrypted face data storage," which is false. Embeddings are more privacy-preserving than raw images, so the current *additional* storage of raw public images (C5) is the worse half — but neither is encrypted.
- **Fix:** [needs your input] Encrypt `faceEncoding` at rest (app-level envelope encryption or DB-level), prefer embedding-only over raw-image retention, and correct the README claim. Gated.

### [High] H2 — No biometric consent, retention, or deletion (RA 10173)
- **Where:** `profile_setup_screen.dart` (capture UX), `authController.ts` (no deletion endpoint), whole schema
- **What's wrong:** The only "consent" is a caption ("This photo will be used to verify your identity at the kiosk"). There is **no** explicit, separate biometric-consent step; **no** consent record stored; **no** defined retention period; **no** deletion/erasure path; and **no** account-deletion flow at all. Under RA 10173 / NPC expectations, biometric processing needs specific informed consent and a real erasure right.
- **Fix:** [needs your input] Add a biometric-specific consent gate (stored, timestamped, versioned), a retention policy, and a deletion endpoint + UI. Gated.

### [Medium] M12 — ID-card image collected but never verified
- **Where:** `authController.ts:completeProfile` (`idImageUrl`), no OCR/verification of the ID
- **What's wrong:** The student ID photo is stored but never checked against `studentId`/name — it provides no assurance, only extra sensitive data at rest. Either verify it (OCR/manual admin step) or justify collecting it.
- **Fix:** [needs your input] Decide whether to verify or stop collecting. Gated (biometric/PII scope).

### Minors (§4): No evidence facial data is reused beyond kiosk matching (good — no scope-creep found). Minors-under-18 consent question is a policy item to raise (engineering intake can include <18 students).

---

## Section 5 — Payment / escrow integrity  **[GATED — PAYMENT]**

### [Critical] C3 — Payment amount is fully client-controlled
- **Where:** `paymentController.ts:145-169` (`createPayment`), `paymentRoutes.ts` (validates only `isFloat({min:0})`)
- **What's wrong:** `const { rentalId, type, amount } = req.body; … amount: parseFloat(amount)`. The charged amount comes straight from the client with no check against `rental.totalPrice`/`rental.securityDeposit`. A renter can pay ₱1 for a ₱5,000 rental. `type` is likewise unchecked against what's actually owed.
- **Fix:** [needs your input] Derive the amount server-side from the rental record; reject client-supplied amounts. Gated (payment).

### [Critical] C4 — There is no real escrow or payout
- **Where:** `paymentController.ts`, `index.ts` (`completeRental`), entire `Transaction` flow
- **What's wrong:** Payments are collected into the platform's PayMongo account. There is **no transfer/payout to the owner** anywhere in the codebase (grep for payout/transfer/disburse: none). "Payment released to owner" exists only as a notification string. So the system's headline value proposition (escrow released after verification) is not implemented — money simply accrues to the platform and is never disbursed, and refund-on-failure is only partially wired.
- **Fix:** [needs your input] Requires a real payout design (PayMongo doesn't do marketplace split-payments the way Stripe Connect does — this needs an actual funds-flow decision). Gated.

### [Info] §5 idempotency — actually handled well
- `confirmPayment` short-circuits on `COMPLETED`/`REFUNDED` and uses a `PENDING → PROCESSING` `updateMany` claim to prevent concurrent double-processing. Webhook signature verified via HMAC-SHA256 (`verifyWebhookSignature`). These are correct. **Caveat:** signature check is skipped when `PAYMONGO_WEBHOOK_SECRET` is unset (`return true`), and the manual/dev confirm branch accepts a bare `transactionId` with no signature — acceptable for dev, must be closed in prod.
- **Fix:** [needs your input] Make signature mandatory in production. Gated (payment).

### [High] H3 — Flutter payment flow targets endpoints that don't exist
- **Where:** `rental_detail_screen.dart:58` → `POST /payments/create-checkout`; `payment_webview_screen.dart:73` → `GET /payments/status/{id}`. Backend only defines `POST /payments`, `POST /payments/confirm`, `GET /payments`, `POST /payments/:id/refund` (`paymentRoutes.ts`).
- **What's wrong:** The mobile payment journey 404s against the real API — payment is broken end-to-end in the app. Response shape also differs (`checkoutUrl`/`sessionId` vs `paymentUrl`/`transaction`).
- **Fix:** [applied automatically] This is route wiring, not escrow logic — align the Flutter calls (and response parsing) to the real endpoints. (The underlying escrow decisions in C3/C4 remain gated.)

---

## Section 6 — Hardware / IoT security & physical safety  **[GATED — HARDWARE]**

### [Critical] C1 — Any socket client can open a physical locker by spoofing `kiosk:face`
- **Where:** `index.ts:751-833` (`kiosk:face` handler)
- **What's wrong:** The `kiosk:face` event is trusted verbatim. A socket that emits `{ rental_id, verified: true }` (for a rental in `DEPOSITED`) makes the server advance to `ACTIVE` and emit `open_door` to the kiosk. Sockets are unauthenticated — there is no kiosk credential, no per-message auth, no check that the emitter is the real Pi. This is a direct physical-security bypass onto solenoid locks.
- **Fix:** [needs your input] Authenticate the kiosk socket (shared secret / signed handshake on `kiosk:register`), and only accept hardware events from an authenticated kiosk socket in the correct room. Gated.

### [Critical] C2 — Same class: `kiosk:images` spoof drives ML verification, completion, and (notional) payment release
- **Where:** `index.ts:340-747` (`kiosk:images` handler)
- **What's wrong:** Any socket can emit `kiosk:images` with an arbitrary `rental_id` and attacker-chosen image URLs. The handler runs verification and, on `APPROVED` at return, calls `completeRental()` (marks item returned, fires "payment will be released" notifications). Combined with C1, an unauthenticated actor can walk a rental through its entire state machine.
- **Fix:** [needs your input] Same kiosk-socket authentication as C1, plus verify the emitting socket is the kiosk that owns the locker/rental. Gated.

### [Critical] C7 — ML service verification/identity endpoints are unauthenticated
- **Where:** `server/python_server/services/ml/app/routers/verification.py` (no auth on `/verify`, `/verify-face`, `/register-face`); `app/main.py` CORS `allow_origins=["*"]`
- **What's wrong:** The Node backend *sends* `X-API-Key` when `ML_SERVICE_API_KEY` is set, but the FastAPI router **never validates it** (no dependency/header check exists). On Render the ML service is publicly reachable (`engirent-ml.onrender.com`), so anyone can submit face images for encoding/verification or run item verification. Face endpoints also `urlretrieve()` arbitrary `reference_image_url` values (SSRF surface).
- **Fix:** [applied automatically — non-destructive hardening] Enforce `X-API-Key` on the ML router when configured and tighten CORS to known origins. (This hardens an existing intended control; it does not alter verification math or hardware behaviour. If you'd prefer this gated too, say so and I'll revert.)

### [High] H4 — Emergency stop is not implemented; `lock_all` is software-only
- **Where:** `server/kiosk/config.py` (no GPIO 23), `socket_client.py:_cmd_lock_all`, `README.md` (claims "Emergency Button GPIO 23, Pull-up")
- **What's wrong:** There is no GPIO-23 handler, no interrupt, no wiring code — the emergency stop the README advertises does not exist. The only "emergency" path is a software `lock_all` that requires the Pi + socket to be responsive. A software-only stop that depends on the controller still running is not a real safety mechanism.
- **Fix:** [needs your input] This is a physical-safety design item (wire E-stop to directly cut actuator/relay power, monitored independently). Gated.

### [Info] §6 MQTT / ESP32 — not applicable (documentation drift)
- The prompt (from README) worried about unauthenticated Pi↔ESP32 MQTT. **Neither MQTT nor ESP32 exists in the real system** — the Pi drives relays directly via `lgpio`, and Pi↔backend is Socket.io over TLS (wss to Render). So the MQTT concern is moot; the real transport risk is the unauthenticated Socket.io layer (C1/C2). Documented so the team stops planning around MQTT.

### [Info] §6 connectivity-loss — mostly safe
- On disconnect, outbound critical events queue to `offline_queue.json` and replay on reconnect. Active-low relays de-energise (lock) on power loss = fail-safe. Risk: if the Pi *process* hangs mid-`unlock_for`, the relay stays energised (unlocked) until the `asyncio.sleep` would have fired. Worth a watchdog. Gated to touch; noted only.

### [Info] §6 conveyor pinch points — physical/mechanical, out of software scope; flag to the hardware team that public-kiosk actuators need guarding.

---

## Section 7 — Raspberry Pi terminal in admin console (new feature)

### [Low] L5 — Not started; recommended approach on file
- **Where:** admin console (`client/admin`) + `server/node_server` (already runs Socket.io)
- **Assessment:** Prompt §7 recommends `xterm.js` in the browser ↔ `ssh2` from the Node backend to the Pi, with a Tier-1 curated-action panel (restart camera/socket service, reboot, view logs, self-test a solenoid) and a re-auth-gated, fully-logged Tier-2 raw shell. This is sound and I concur. **However, per §7.3 this must not ship on top of the unauthenticated hardware layer** — C1/C2/C7 must be fixed first, or a terminal panel just adds a nicer front door to the same hole.
- **Fix:** [needs your input] This is net-new hardware-adjacent surface. I've documented the plan; I will not build it until you confirm, and not before C1/C2 are resolved. Gated by association.

---

## Section 8 — AI/ML verification pipeline

The pipeline matches `AI_SYSTEM_DOCUMENTATION.md` faithfully: 8 stages, trimmed-mean aggregation (drop bottom 20%/top 10%), min-2-good-pairs safety demotion, additive-only +10 OCR bonus (capped at 100, cannot alone approve), weights configurable and summing correctly, deposit+return both wired. These are genuinely well-designed and verified against code (`hybrid.py`, `similarity.py`, `config.py`). Two real defects:

### [High] H8 — ML feature cache is never invalidated on photo change
- **Where:** `itemController.ts:updateItem` (updates `images`, leaves `mlFeatures` untouched)
- **What's wrong:** `Item.mlFeatures` caches features extracted from the *original* photos. If an owner edits/replaces listing photos, the stale cached vectors are still sent as `reference_features` and compared against the new item → silently wrong verification results (prompt §8 called this out).
- **Fix:** [applied automatically] Null out `mlFeatures` whenever `images` changes in `updateItem`, and re-trigger background extraction.

### [High] H9 — `persistMlFeatures` stores the wrong object into `Item.mlFeatures`
- **Where:** `index.ts:131-156` (`persistMlFeatures`) + call sites at 528
- **What's wrong:** It writes the **verification result** (`{decision, confidence, method_scores, ocr}`) into `Item.mlFeatures`. But `hybrid.py` expects that field to contain `{traditional, deep, ocr_texts, image_count}`. Since the persisted blob has no `"traditional"` key, every later verification silently ignores it and re-extracts from scratch — so the "cache" both mislabels the column and does nothing. Harmless to correctness, but dead/confusing and defeats the caching optimisation.
- **Fix:** [applied automatically] Remove `persistMlFeatures` (feature caching is already correctly done by `itemController.createItem` → `/extract-features`).

### [Info] §8 test suite — known-absent, as documented
- `pytest` is in requirements but no tests exist. Per prompt §8, the task is to *write* coverage for the numeric edge-case logic (`_aggregate_scores`, min-good-pairs demotion, OCR-bonus cap, weight redistribution when deep learning disabled). Proposed as follow-up work; not blocking.

### [Info] §8 thresholds/precision-recall — thresholds match code; real precision/recall requires labelled verification attempts the team must supply. Raise with team.

---

## Section 9 — Performance

### [Low] L4 — AI-verification latency unmeasured (likely the dominant kiosk cost)
- **Where:** `hybrid.py` full pipeline; `deep.py` ResNet50 on CPU (`render.yaml` ML = Docker CPU-only)
- **What's wrong:** 8 stages including ResNet50 CPU inference (~500 ms/image per the docs) over 3×3 image pairs, plus SIFT/RANSAC/SSIM/OCR, run synchronously inside the `kiosk:images` socket handler while a student waits at the kiosk. Not measured end-to-end. Feature caching helps the *reference* side only; kiosk-side extraction is always fresh.
- **Fix:** [needs measurement] Instrument stage timings; if the deposit path is >~10 s, consider deferring the ResNet50 stage or GPU. Documented; measurement is a runtime task.

### [Low] L3 — Missing index for the late-fee scan
- **Where:** `schema.prisma` `Rental` (no `@@index([endDate])`), `index.ts` cron `where: { status: ACTIVE, endDate: { lt: now } }`
- **Fix:** [applied automatically] Add `@@index([status, endDate])` on `Rental`.

### [Info] §9 Socket.io — server emits are consumed client-side (`socket_service.dart` subscribes to rental/deposit/return/face events; admin uses SSE). Real cross-surface sync is plausible but should be smoke-tested on real devices (ties into §11.5).

---

## Section 10 — Code & repo hygiene

### [Medium] M6 — Large binaries committed to git
- **Where:** `Engirentpre2.apk` (73 MB) and `AI_SYSTEM_DOCUMENTATION.pdf` (723 KB) at repo root
- **Fix:** [applied automatically] `git rm --cached` both, add to `.gitignore`, and point README at GitHub Releases for the APK. (History rewrite to reclaim space is optional and destructive — flagged, not done.)

### [Medium] M5 — Redundant/drifted documentation
- **Where:** `README.md`, `AI_VERIFICATION_GUIDE.md`, `EngiRent_Hub_Analysis.md` all still describe **YOLOv8** and **GCash**; only `AI_SYSTEM_DOCUMENTATION.md` and `analyzation.md` reflect reality (hybrid CV + PayMongo).
- **Fix:** [applied automatically] Add a "⚠️ Superseded — see AI_SYSTEM_DOCUMENTATION.md / analyzation.md" banner to the three drifted docs and correct the YOLOv8/GCash claims in README.

### [Medium] M7 — README clone URL placeholder
- **Where:** `README.md` (`git clone https://github.com/your-username/engirent-hub.git`, and badge/issue links)
- **Fix:** [applied automatically] Replace with `https://github.com/Shaloh69/EngiRent`.

### [Medium] M8 — Kiosk `.env.example` uses a stale Supabase project ref
- **Where:** `server/kiosk/.env.example` → `SUPABASE_URL=https://zezsxfyoufqqxaffsvng.supabase.co`
- **What's wrong:** That is one of the old/incorrect project refs; the correct ref is `hosyeqkzkhewtadicgba`. It's a placeholder (no secret leaked) but misleads setup.
- **Fix:** [applied automatically] Point the example at the correct project ref (key stays a placeholder).

### [Low] L1 — "44.1% Makefile" language stat
- **Where:** GitHub Linguist
- **What's wrong:** No `Makefile` is tracked (`git ls-files` → 0). The stat is almost certainly Linguist miscounting a committed binary (the APK/PDF) or previously-committed build output. Removing the APK/PDF (M6) will likely correct it.
- **Fix:** [applied automatically via M6] Re-check after the binary removal; add `.gitattributes linguist-vendored` rules if it persists.

### [Low] L2 — `favicon.ico` at repo root
- **Fix:** [applied automatically] Move under the web app's `public/` (or leave; harmless). Low priority.

### [Info] §10 `.env.example` files — all three (`node_server`, `kiosk`, `ml`) contain only placeholders, no real secrets. Good. `.env` files are correctly untracked.

---

## Additional findings not tied to a single prompt section

### [Medium] M1 — Rate limiter is in-memory and skips all admin routes
- **Where:** `middleware/rateLimiter.ts` (in-process `store`), `index.ts:52-55` (skips `/admin`)
- **What's wrong:** Resets on every restart and isn't shared across Render instances, so limits are soft. All `/admin/*` routes bypass it entirely. (Admin *login* goes through `/auth/login`, which *is* limited — so login brute-force is covered — but admin data endpoints are unthrottled.)
- **Fix:** [applied automatically] Keep behaviour but document the limitation and add a short comment; a durable store (Redis) is a deploy decision, noted not forced.

### [Medium] M2 — Stale hardware config after the trapdoor removal
- **Where:** `adminController.ts:698` (`DEFAULT_LOCKER_CONFIG.actuator_speed_percent`), `prisma/seed.ts` (`solenoid_pins` include `trapdoor`, old GPIO map, `camera_indices` with 2 item cameras)
- **What's wrong:** The design moved to 2 doors + `lgpio` actuators (no `actuator_speed_percent`, no trapdoor, 4 USB item cameras), but the admin default config and DB seed still carry the old trapdoor pins and speed field. The Pi ignores them (per `socket_client.on_config`), but they mislead and can overwrite `kiosk_config.json` shape expectations.
- **Fix:** [applied automatically] Update `DEFAULT_LOCKER_CONFIG` (drop `actuator_speed_percent`) and `seed.ts` kiosk config to the 2-door/4-camera reality.

### [Medium] M3 — Late fee is a hardcoded flat ₱50/day
- **Where:** `index.ts:1101` (`LATE_FEE_RATE_PER_DAY = 50`)
- **What's wrong:** Ignores per-item late-fee rates (ITEM_CATEGORIES suggests ₱5–₱80/day by item). Also ledger-only (no real charge — ties to C4).
- **Fix:** [applied automatically for the rate source] Derive from the item/rental where available; keep ₱50 as fallback. (Actual collection remains gated with C4.)

### [Medium] M9 — ML CORS wildcard (folded into C7 fix)
### [Medium] M11 — `updateRentalStatus` allows arbitrary transitions
- **Where:** `rentalController.ts:260-361`
- **What's wrong:** Any participant (renter or owner) can `PATCH /rentals/:id/status` to any `RentalStatus` with no state-machine guard (e.g. jump straight to `COMPLETED`, or set `DEPOSITED` without verification). The real lifecycle is enforced in the socket handlers, so this endpoint is a bypass.
- **Fix:** [applied automatically] Restrict this endpoint to a small whitelist of legal manual transitions (or admin-only), so it can't skip verification/payment gates. (No payment *logic* changed — it removes a bypass — so treated as non-gated hardening. Tell me if you want it gated.)

### [High] H6 — 1-hour unclaimed auto-move & conveyor recovery not implemented
- **Where:** no cron/timer for it; hardware has actuators (place item) but no conveyor-to-storage
- **What's wrong:** A headline feature ("auto-move unclaimed items to storage after 1 hour", "zero human interaction") has no implementation and no hardware path. Retrieving from "delayed pickup storage" (notifications reference it) has no corresponding state.
- **Fix:** [needs your input on scope] This is a feature+hardware decision (is there physically a storage conveyor?). Documented; not silently invented.

### [High] H7 — Kiosk UI has no "verifying — do not leave" state and doesn't suspend idle-timeout
- **Where:** `server/kiosk/kiosk_ui/static/app.js` (states: IDLE, MAIN, FACE, SUCCESS, ERROR — no VERIFYING), `_resetInactivity()`
- **What's wrong:** Item AI-verification happens server-side during/after `capture_image`, but the kiosk screen has **no dedicated state** telling the user "checking your item — do not leave (~15 s)", and the inactivity timer isn't suspended during it. This is precisely the §12.4 bug class: the screen can revert toward idle while a verification the user was told to wait for is still running.
- **Fix:** [applied automatically — kiosk UI, not firmware] Add a persistent "verifying / do not leave" state and suspend the idle timer while it's active. (This is UI/JS, not lock-control firmware, so non-gated — confirm if you'd rather I hold it.)

### [Low] L6 — Unused Flutter dependencies
- **Where:** `pubspec.yaml` — `get_it`, `dio`, `go_router` installed but the app uses `Provider`, `http`, and named routes.
- **Fix:** [applied automatically] Remove the three unused deps (reduces app size, avoids confusion). Verified no imports reference them before removal.

---

## Sections 11–12 — Design revamp (web / mobile / admin / kiosk)

Not started in this pass — design work follows the audit-and-fix cycle per the prompt's ordering, and several §12 kiosk screens depend on resolving the §3 process gaps (H5 fallback, H6 capacity, H7 verifying-state) which are partly gated. Approach is documented and ready:
- **Student-facing (web+mobile):** "Verified Campus Marketplace" — teal/emerald primary, amber accent, warm neutrals; per-surface `DESIGN.md` with banned-pattern list; `skeletonizer` + Lottie/Rive + `flutter_animate` + `cached_network_image`; one 4-category toast system (already partially present via `toastification`).
- **Admin:** "Operations Console" — near-black, green/amber/red status convention, single cyan accent; accommodates the §7 terminal.
- **Kiosk:** two-mode (attract/active) step-wizard with the §12.4 idle-suspend fix (H7) and dedicated screens for the §3 gaps.

I'll begin design work on your go-ahead, and after the gated items in §§4–6 have a decision, since kiosk screens must reflect the resolved flows.

---

## ⚠️ Items requiring your review before I change them (gated — prompt §0)

These are surfaced explicitly regardless of how mechanical the fix looks, because a silent mistake here moves real money, exposes biometric data, or actuates physical locks:

**Biometric / privacy (RA 10173):**
- **C5** — face/ID/kiosk images in a public bucket → move to private + signed URLs
- **C6** — `faceEncoding` unencrypted at rest; README claims encryption
- **H2** — no biometric consent / retention / deletion / account-deletion
- **M12** — ID image collected but unused; keep-and-verify or stop collecting

**Payment / escrow:**
- **C3** — client-controlled payment amount → must derive server-side
- **C4** — no real escrow or payout to owner exists at all
- **H1** — security deposit never collected/refunded; damage fees ledger-only
- **§5** — webhook signature optional/bypassable in the manual-confirm path

**Hardware / physical safety:**
- **C1 / C2** — unauthenticated Socket.io events open lockers and drive rental/payment state
- **H4** — emergency stop (GPIO 23) not implemented; software-only `lock_all`
- **H6** — 1-hour auto-move / conveyor recovery not implemented (feature + hardware decision)
- **§7** — Pi terminal feature must wait until C1/C2 are fixed

**Borderline (I plan to fix as hardening, but tell me to hold if you disagree):**
- **C7** (enforce existing ML `X-API-Key` + tighten CORS), **M11** (block arbitrary rental-status transitions), **H7** (kiosk "do not leave" UI state), **H3** (repoint Flutter to real payment endpoints — wiring only, not escrow logic).
