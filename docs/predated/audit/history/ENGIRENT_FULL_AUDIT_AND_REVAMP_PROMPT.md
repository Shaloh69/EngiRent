> **SUPERSEDED — reflects the plan as of 2026-07-20.**
> The prompt that produced `AUDIT.md` in this folder. Kept as history.
> The current equivalent is `docs/redesign/KICKOFF_PROMPT.md`.

# EngiRent Hub — Full Audit & Revamp Prompt

> Read the actual repo (`https://github.com/Shaloh69/EngiRent`) before doing anything else — specifically `client/`, `server/`, `AI_SYSTEM_DOCUMENTATION.md`, `AI_VERIFICATION_GUIDE.md`, `EngiRent_Hub_Analysis.md`, `ITEM_CATEGORIES.md`, and `analyzation.md`. This prompt was written from the README alone; treat everything below as hypotheses to verify against real code, not settled fact.

## 0. What this system actually is, and why the audit priorities differ from a typical web app

EngiRent Hub is a UCLM College of Engineering thesis project: a smart kiosk for student-to-student item rentals, combining a Next.js web app, a Flutter mobile app, a React kiosk touchscreen UI, a Node.js/Express + MySQL/Prisma backend, a standalone Python/FastAPI 8-stage hybrid image-verification microservice (confirmed via `AI_SYSTEM_DOCUMENTATION.md` — not YOLOv8, see section 8), and physical hardware (Raspberry Pi 4 main controller, ESP32 locker controllers, solenoid locks, a conveyor system, QR scanning, and facial recognition).

This changes the audit's shape relative to a normal SaaS product. Three categories here are genuinely higher-stakes than anything in a typical audit, and get their own dedicated top-level treatment rather than being folded into a general "security" bucket:
1. **Biometric data** — facial recognition for kiosk access is real, sensitive personal data, not a convenience feature to wave through.
2. **Real money** — GCash escrow is an actual financial transaction system, not a mock payment flow.
3. **Physical hardware that locks/unlocks things and moves a conveyor** — a software bug here can mean a student can't retrieve their belongings, someone else's locker opens, or a physical safety incident, not just a broken UI.

**Full-sweep authorization, with three exceptions specific to this system** (mirroring the same principle used elsewhere: fix freely, but pause on the categories where a silent mistake has outsized real-world consequences):
- Any change to how facial recognition data is captured, stored, or retained needs a flag before changing, not a silent fix — this is Data Privacy Act territory (Philippines RA 10173), not just a code style choice.
- Any change to escrow/payment release logic needs a flag before changing — a silent bug here means real money moving incorrectly.
- Any change to locker/conveyor control firmware or the API that triggers it needs a flag before changing — this controls physical hardware near people.

Everything else — code quality, missing features, performance, repo hygiene, most of the AI pipeline — gets fixed under normal full-sweep authorization once found.

### 0.1 Process: document, research, then fix — don't just patch on instinct

For every finding in this audit, follow the same three-step loop rather than jumping straight to a fix:
1. **Document** the finding in `AUDIT.md` (format in section 11) — what's wrong, where, and why it matters.
2. **Research** the current, correct way to address it before writing a fix — check actual current library documentation, established security practices, or a real reference implementation, rather than fixing from memory or a first guess. This matters especially for the biometric/privacy (section 4), payment (section 5), and hardware (sections 6–7) findings, where "a plausible-looking fix" and "the actually correct fix" can differ in ways that matter.
3. **Fix**, citing what the research step found as the justification in the commit/PR description — so the fix is traceable to a reason, not just a guess that happened to compile.

This is the same discipline used throughout this whole project's planning work — ground decisions in verified current information rather than assumption — applied now to the actual audit-and-fix cycle, not just the planning documents.

---

## 1. Reconcile documented structure against actual structure — do this first

The README describes an elaborate structure (`apps/mobile/`, `apps/web/`, `apps/kiosk/`, `backend/`, `ml-service/`, `hardware/raspberry-pi/`, `hardware/esp32/`, `docs/`, `tests/`, `docker/`, `scripts/`, `.github/workflows/`). The actual repo's top level shows only `client/` and `server/` alongside root-level files (`.claude/`, `.vscode/`, several standalone `.md` files, an `.apk`, `render.yaml`). These don't match, and this needs resolving one way or the other, not left ambiguous:
- **One piece of this is now confirmed, not a mystery:** `AI_SYSTEM_DOCUMENTATION.md` states the ML service actually lives at `server/python_server/services/ml/` — nested inside `server/`, not as a sibling `ml-service/` directory like the README implies. This is a real, useful starting point: the AI verification service is a FastAPI app on port 8001, called from `server/src/controllers/kioskController.ts` on the main Node API (port 5000). Use this as the confirmed anchor point when mapping the rest of `client/`/`server/` against the README's aspirational structure, rather than starting from zero.
- Map what's actually inside `client/` and `server/` against the documented structure — is the mobile app and kiosk UI actually inside `client/` under different names, or do they genuinely not exist yet?
- The README's deployment section describes AWS EC2 + Nginx + Certbot in detail; the repo has a `render.yaml`, which is a Render.com deployment file — these are two different deployment targets. Confirm which one is actually true and delete or clearly mark the other as aspirational/outdated documentation.
- Once the real structure is confirmed, either update the README to describe reality, or treat the documented structure as the target and note what's missing to get there — don't leave a reader unable to tell which parts of the README describe the actual system.

---

## 2. Functional completeness — verify against the actual feature list

The README claims Phase 1 (MVP) is complete: auth, item listing/browsing, rental request workflow, GCash integration, kiosk hardware, QR + facial recognition, and AI item verification. Check each of these against running code, not the checkbox in the README:
- Dual biometric auth (QR + facial recognition) — does both actually gate kiosk access, or is one a stub?
- AI item verification — does the real 8-stage hybrid pipeline (section 8) run end-to-end at both the deposit and return checkpoints, or is part of this mocked?
- Escrow payment — does it actually hold funds and release only after verification, or does it release immediately regardless of verification outcome?
- The 1-hour auto-conveyor-to-storage rule for unclaimed items — implemented, or just documented intent?
- Late fee automation, rating system, damage compensation — same treatment, verify each individually.

Output: a status table (Done / Partial / Missing / Drifted), same discipline as any completeness audit — "the feature exists" isn't an acceptable answer without saying what specifically was checked.

---

## 3. Process & business-logic analysis — the rental lifecycle itself

**Updated after reading `EngiRent_Hub_Analysis.md` and `AI_SYSTEM_DOCUMENTATION.md` directly** — several of the items below were originally written as open hypotheses (README-only analysis) and are now confirmed, resolved, or elevated based on your team's own documentation. Marked inline below. Items not mentioned in either document are still open questions worth raising with the team directly, not a code-verification task.

### 3.1 Escrow release timing — confirmed, and the gap it creates is real, not hypothetical

`EngiRent_Hub_Analysis.md`'s process flow confirms this directly: escrow releases to the **owner** immediately once deposit-checkpoint AI verification succeeds ("Match? → Payment released to owner"), not after the full rental period or return verification. This is Design A from my original analysis, now confirmed rather than guessed.

**This confirms the real gap, not just the theoretical one:** with payment released at deposit, there is no rental-fee escrow left by the time a damage penalty needs to be charged at return. See 3.2 — this isn't a "check whether" anymore, it's "this needs an actual funding mechanism that isn't currently described anywhere."

### 3.2 Damage penalties need a defined funding source — confirmed gap, not fixed by either document

Both documents describe damage penalties as an outcome ("Damaged/Missing? → Damage penalty charged") but neither describes *where that charge draws from*. Given 3.1 confirms the rental fee is already released to the owner at deposit, a damage penalty at return has no held-funds pool to draw from unless there's a separate renter-side security deposit — and neither document mentions one existing. **This is the single most concrete, checkable gap in this whole audit: ask directly whether a security deposit mechanism exists in the code, distinct from the rental-fee escrow. If it doesn't, "damage penalty charged" is a documented feature with no implementation path, and that's worth fixing before this goes further into deployment**, not just noting.

### 3.3 Non-return (theft) escalation path — still not addressed in either document

Neither document describes what happens if a renter simply never returns an item. This remains an open question worth raising directly with the team rather than something to find in code — it may genuinely not be designed yet. My original opinion stands: the campus/enrolled-student context gives this system a real institutional lever (academic hold, student affairs referral) a generic rental app doesn't have, and it's worth using if it isn't already.

### 3.4 Retry-attempt exhaustion — resolved, this was well-designed

**Correcting my original concern:** `AI_SYSTEM_DOCUMENTATION.md`'s decision flow defines this clearly. Score < 60 with attempt = 10 → `REJECTED`. At the deposit checkpoint this cancels the transaction, refunds the renter, and returns the item to the owner. At the return checkpoint it moves to `DISPUTED` status for admin review rather than being cancelled (since the renter still physically has the item — a sensible distinction). This was a real, thought-through design; verify the implementation matches what's documented, but this is no longer an open gap.

### 3.5 Dispute/manual-review SLA — partially addressed, timing still open

The `PENDING` decision state (score 60–84) routes to admin manual review, and the notification flow confirms case tracking exists ("Dispute opened," "Admin reviewing case," "Case ID: [XXX]"). What's still not specified in either document: how long a case can sit in `PENDING`/disputed status before some default action or escalation kicks in. The infrastructure for tracking a case exists; a time-bound SLA does not appear to. Worth checking directly rather than assuming it's missing from the code just because it's missing from the docs.

### 3.6 Facial recognition failure fallback — confirmed, and more serious than originally flagged

**Elevating this finding.** The kiosk touchscreen flow doc states plainly: "No match? → Retry (3 attempts) → **Lock account**." No alternative path (PIN, QR-only fallback, staff override) is described anywhere in either document. This means a legitimate user who fails face-match three times for an innocent reason — poor lighting, a camera angle, wearing a mask, a recent haircut, a temporary camera fault — gets **locked out of their account**, with no documented unlock process. This is a real, confirmed design decision worth pushing back on directly, not a hypothetical accessibility concern: ask whether an unlock process exists (admin-mediated, a cooldown period, a secondary verification method) and if not, treat adding one as a priority fix rather than a nice-to-have, since this is the kind of thing that generates real support tickets the moment this is used by actual students.

### 3.7 Rating system directionality — still open, not addressed in either document

No change from the original finding — neither document describes a renter-rates-owner path, only owner-rates-renter. Still worth verifying directly.

### 3.8 Demand contention on popular items — still open

Not addressed in either document. Still worth verifying directly, especially given the survey's demand numbers for lab gowns and calculators specifically.

### 3.9 Kiosk-full capacity handling — still open

Not addressed in either document.

### 3.10 "Zero human interaction" vs. the conveyor-to-storage recovery path — still open

Not addressed in either document — the notification flow describes the item being "moved to delayed pickup storage" after 1 hour unclaimed, but doesn't describe whether retrieving it from that storage state requires staff intervention.

---

## 4. Biometric data & privacy audit — this is the section that matters most

Facial recognition data is being collected from actual students. Treat this with the seriousness of an actual Data Privacy Act (RA 10173) compliance question, not a generic "is auth secure" check:

- **What's actually stored** — raw face images, or face embeddings/feature vectors only? Embeddings are meaningfully more privacy-preserving (they can't be trivially reconstructed into a photo) and should be preferred if the current implementation stores raw images.
- **Encryption at rest** — the README claims "encrypted face data storage." Verify this is actually true in the database schema/storage layer, not just stated.
- **Consent** — is there an explicit, informed consent flow before a student's face is captured, separate from general terms-of-service acceptance? A biometric-specific consent step is a real NPC (National Privacy Commission) expectation, not optional.
- **Retention and deletion** — is there a defined retention period, and can a student actually request deletion of their biometric data (a real right under RA 10173)? Check whether this is implemented anywhere, including account deletion flows.
- **Minors** — confirm whether any enrolled students could be under 18 (possible for younger incoming engineering students) and whether that changes consent requirements.
- **Scope creep risk** — confirm the facial recognition data is used only for kiosk access matching, not silently reused for anything else (e.g. attendance tracking, analytics) without separate disclosure.

This section's findings go in `AUDIT.md` under their own heading, not buried inside a general security section — this is the single highest-consequence area in the whole system if done wrong.

---

## 5. Payment/escrow integrity audit

Real money via GCash, held in escrow pending AI verification — audit this like a financial system, not a feature:
- **Atomicity** — can a race condition release escrowed funds twice, or fail to release them after a successful verification (leaving a renter's payment stuck)?
- **Refund/dispute path** — when AI verification fails and goes to manual review, what happens to the held payment during that window? Confirm there's no path where a failed/disputed rental still auto-releases funds.
- **Reconciliation** — is there a way to detect a mismatch between what GCash's API confirms and what the database records as a transaction's status, or would a webhook failure silently desync the two?
- **Idempotency on payment webhooks** — GCash (or Xendit, per the README's alternative) will retry webhook delivery; confirm duplicate webhook deliveries can't double-process a payment.

---

## 6. Hardware/IoT security and physical safety audit

- **MQTT authentication/encryption** — is the Raspberry Pi ↔ ESP32 MQTT traffic authenticated and encrypted (TLS), or is it plaintext on the local network? An unauthenticated "unlock" message on the MQTT topic is a direct physical-security bypass — verify this is actually locked down, not assumed.
- **Flask hardware API server** (on the Raspberry Pi) — confirm this has real authentication, not just being reachable only "because it's on the local network." Local-network-only is not the same as secure.
- **Emergency stop button (GPIO 23)** — confirm this is wired as a genuine physical fail-safe (cuts power/motor control directly), not only monitored in software — a software-only emergency stop that depends on the Pi still being responsive is not a real safety mechanism.
- **Conveyor pinch points** — this is a physical safety question, not a software one: confirm the physical design has appropriate guarding, since a student's hand near a conveyor system is a real injury risk in a public kiosk.
- **Connectivity-loss handling** — what happens to a locker's state if the Raspberry Pi loses connection to the backend mid-transaction? Confirm this fails to a safe, recoverable state (e.g. locker stays locked, transaction marked for manual reconciliation) rather than an ambiguous state that could strand an item or double-allow access.

---

## 7. New feature — Raspberry Pi terminal control in the admin console

This is a real, useful feature to add — remote diagnostics and control of the kiosk hardware without needing physical/SSH access from a laptop — but it needs to be built with the same seriousness as section 6, since it's a new attack surface directly onto hardware that controls physical locks. Don't ship this as raw, unrestricted shell access by default.

### 7.1 Standard, proven technique — don't build a custom terminal protocol

Browser-based terminals are a solved problem: **`xterm.js`** (the terminal renderer used by VS Code, Hyper, and most web-based terminal tools) on the frontend, connected via WebSocket to a backend process. Two viable wiring patterns, given EngiRent's actual stack:
- **Recommended: SSH out from the existing Node.js backend, not a new agent on the Pi.** The Node backend (which already runs Socket.io) uses an SSH client library (e.g. `ssh2`) to connect to the Raspberry Pi over SSH, and relays that session's I/O to the admin's browser via `xterm.js` over the existing WebSocket infrastructure. This keeps the Pi's exposed surface unchanged — it just needs SSH reachable from the backend (ideally key-based auth, not password), and all the new security logic (auth, logging, restriction) lives in the already-more-securable Node layer rather than adding new code to the Pi's Flask API.
- **Alternative: a `pyxtermjs`-style endpoint added directly to the Pi's Flask app** (Flask + `flask-socketio` + a spawned pty), if SSH access to the Pi isn't practical. This adds new surface directly to the hardware controller, so it needs at least as much scrutiny as the MQTT/Flask-API findings in section 6 — don't add this without re-auditing the Pi's exposed endpoints afterward.

### 7.2 Don't default to unrestricted shell access — tiered access model

Full arbitrary shell access is more risk than most admin tasks actually need. Build two tiers:
- **Tier 1 (default): a curated set of predefined actions**, exposed as buttons/commands rather than a raw prompt — restart a specific service (camera, MQTT client), reboot the Pi, view recent logs, check a specific locker's sensor/lock status, run a self-test on a solenoid. This covers the large majority of real admin need without arbitrary-command risk.
- **Tier 2 (raw terminal, explicitly gated):** only for cases Tier 1 doesn't cover. Gate it behind re-authentication at the moment of opening a session (not reuse of the general admin login), a clear warning banner that this is a live shell on hardware controlling physical locks, and mandatory session logging (every command, with timestamp and admin identity, retained the same way any security-sensitive audit log would be) — this isn't optional, an un-logged raw shell onto lock-controlling hardware is not an acceptable configuration.
- Consider IP-allowlisting or requiring Tier 2 access to originate from a trusted network, not just "any authenticated admin, from anywhere."

### 7.3 Where this fits with section 6's findings

This feature must not become the thing that undermines the MQTT-auth and Flask-API-auth findings from section 6 — if either of those turns out to be weak, fixing them takes priority over shipping this feature, since a terminal control panel built on top of an already-insecure hardware layer just gives an attacker a nicer interface to the same hole.

---

## 8. AI/ML verification pipeline audit — corrected against `AI_SYSTEM_DOCUMENTATION.md`

**This entire section was originally written assuming a YOLOv8 classifier, per the README. It isn't one — `AI_SYSTEM_DOCUMENTATION.md` states this explicitly: "It is not a YOLOv8 detector, despite early documentation mentioning it."** The real system is a standalone Python/FastAPI microservice (port 8001, called from `server/src/controllers/kioskController.ts`) running an 8-stage hybrid similarity pipeline: image quality gate → perceptual hash pre-filter → traditional CV (color histogram, spatial pyramid, Hu moments, LBP texture, HOG, ORB) → SIFT + FLANN + RANSAC geometric matching → SSIM structural similarity → ResNet50 deep features (ImageNet-pretrained, cosine similarity) → OCR serial-number matching (Tesseract) → a weighted hybrid score with trimmed-mean aggregation across image pairs. Audit against *this* architecture, not the README's simplified description:

- **Two checkpoints, confirmed and correctly designed.** Deposit-time verification protects the renter (is this the genuine listed item, not a swap?); return-time verification protects the owner (is this returned in the same condition?). This is a real, thoughtfully symmetric design — confirm it's actually wired to run at both points, not just one.
- **Decision thresholds are already well-specified** — verify these against the real code rather than re-deriving them: score ≥ 85 → `APPROVED` (payment releases/auto-completes), 60–84 → `PENDING` (routed to admin manual review), < 60 → `RETRY` (attempt < 10) or `REJECTED` (attempt = 10, cancelled/refunded or disputed depending on checkpoint). Ask for the actual precision/recall this threshold set produces on real verification attempts, not just confirmation the thresholds exist as written.
- **The trimmed-mean aggregation and "minimum 2 good pairs" safety check are genuinely good anti-gaming design** (dropping the bottom 20%/top 10% of pairwise scores before averaging, and refusing to auto-approve on a score ≥ 85 unless at least 2 of the 9 image pairs independently scored ≥ 60) — confirm these thresholds (20%/10% trim, the "2 good pairs" minimum) were chosen deliberately and tested, not just copied from an example without re-validating for this specific verification task.
- **The OCR serial-number bonus (+10 to final score) is additive, not a hard override** — confirm this is actually implemented as additive-only as documented (it "cannot single-handedly approve a verification"), since an OCR bonus that could push a borderline score over 85 alone would be a real gaming vector (fake or reused serial-number stickers).
- **ResNet50 runs on CPU by default** (`PyTorch uses CPU inference by default`, per the deployment section) — this is a real, checkable performance question for section 9: time actual inference latency in this configuration specifically, since CPU-based deep-feature extraction on top of 7 other stages could be the dominant cost in the verification latency a kiosk user actually experiences.
- **The project's own documentation states its test suite doesn't exist yet** ("pytest ... test suite not yet written, present in requirements") — this isn't something to discover, it's already known. Don't spend audit effort "running pytest and reporting failures" against a suite that was never written; the actual task is writing test coverage for the 8-stage pipeline (especially the aggregation/safety-check logic, which is exactly the kind of numerical edge-case logic that benefits most from unit tests) from scratch.
- **ML-service-unavailable fallback exists in the schema** (`Verification.reviewNotes` captures strings like `"ML service unavailable: ..."`) — confirm what actually happens procedurally when the Python service is unreachable: does the transaction default to `PENDING`/manual review, block entirely, or something else? The schema suggests a fallback path was designed for; verify it's actually reachable in practice, not just a field that exists.
- **Feature caching** (`Item.mlFeatures` JSON column caching pre-extracted reference-image features) — confirm this cache actually invalidates correctly if an owner edits/replaces listing photos after initial extraction; a stale cached feature vector compared against updated photos would silently produce wrong verification results.

---

## 9. Performance audit

- **AI verification latency** — time the actual path from item-camera capture through all 8 pipeline stages (section 8) to a decision, specifically noting that ResNet50 deep-feature extraction runs on CPU by default per the deployment docs — this is likely the single most expensive stage layered on top of 7 others, and a student standing at a kiosk needs the whole chain fast enough not to feel broken. Measure it end-to-end, don't assume it's fine because each individual stage is fast in isolation.
- **Socket.io real-time updates** — confirm rental status changes actually push to connected clients end-to-end, not just that the server emits an event with no confirmed client-side handling.
- **Database performance under realistic load** — the schema (`users`, `items`, `rentals`, `transactions`, `notifications`, `lockers`, `verifications`) should be checked for missing indexes on foreign keys/status columns as transaction volume grows, not just correctness at low volume.

---

## 10. Code & repo hygiene audit

- **`Engirentpre2.apk` is committed directly to the repo root** — compiled binaries don't belong in version control; move this to GitHub Releases (or equivalent) and remove it from git history if it's bloating the repo.
- **Four overlapping root-level docs** (`AI_SYSTEM_DOCUMENTATION.md`, `AI_VERIFICATION_GUIDE.md`, `EngiRent_Hub_Analysis.md`, `analyzation.md`) — read all four and check whether they're actually distinct documents serving different purposes, or overlapping/redundant drafts that should be consolidated. Redundant docs that drift out of sync with each other are worse than no docs.
- **The 44.1% Makefile language statistic is suspicious** — that's an unusually large share for a Next.js/Flutter/Node/Python stack. Check what's actually contributing to this (a vendored dependency, a large generated file, build artifacts accidentally committed) rather than assuming it's meaningful.
- **README clone URL uses a placeholder** (`your-username/engirent-hub`) instead of the real repo path — small, but worth fixing along with everything else while in here.
- **`.env.example` files** — confirm they exist for both `backend/` and `ml-service/` (per the installation instructions) and contain no real credentials, matching the same discipline already established for the Solence project's secrets handling.

---

## 11. Full design revamp — mobile app, admin console, and web (with real color, motion, and loading-state direction)

Three separate frontends (Next.js web, Flutter mobile, React kiosk — kiosk gets its own dedicated section 12), plus the admin console gaining a new terminal feature in section 7 — all get real design work here, not a template dropped in unchanged. Use the same disciplined methodology already proven out on the Solence project: a `/DESIGN.md` per surface with exact tokens and an explicit banned-pattern list, read before generating anything. Vague direction like "clean and modern" produces nothing distinctive — naming a real aesthetic, real hex values, and a real animation strategy does.

### 11.1 Two named aesthetic directions, not one look stretched across everything

**Student-facing (web + mobile): "Verified Campus Marketplace."** Approachable and fast, but with trust made visible rather than assumed — this system handles biometric auth, escrow money, and AI-verified item condition, and the design should say so at a glance, not bury it in copy. Concrete starting palette (a real proposal to refine, not a placeholder):
- **Primary — deep teal/emerald** (something in the `#0F6E5C`–`#0D8A6E` range): teal reads as "verified/secure" in fintech and marketplace apps for a real reason — it's distinct from the generic blue every SaaS app defaults to, and it gives "escrow protected," "AI verified," and "returned in good condition" states a consistent, recognizable color language throughout the app.
- **Accent — warm amber/gold** (`#E8A33D`–`#F0B429` range): for CTAs, active states, and anything time-sensitive (return deadlines, pending actions) — warm enough to feel like a campus/community marketplace rather than a corporate fintech app.
- **Neutrals — warm off-white and warm charcoal**, not stark `#FFFFFF`/`#000000` — a slightly warm neutral scale reads as considered rather than a default Material/Tailwind palette left untouched.
- **Explicitly banned:** the purple-to-blue gradient, default Material Design blue-500 anywhere, generic "Roboto everywhere with no type-scale personality."

**Admin console: "Operations Console."** Dense, dark-mode-first, monitoring-oriented — closer to an instrument panel than a friendly consumer app, and now needs to visually accommodate the terminal feature (section 7) without looking like two different products stitched together.
- **Base — near-black surface** (`#0D1117`-ish, the same tone real dev-tool dashboards and terminal emulators converge on for a reason: it's genuinely easier to scan dense data and read terminal output on for long sessions).
- **Status color convention, used consistently everywhere in the admin console** (locker status, payment status, hardware connectivity, terminal session state): green for healthy/online, amber for warning/needs-attention, red for critical/offline — a real, established operations-dashboard convention, not arbitrary color choices per screen.
- **One accent color** or the terminal/monitoring feel gets muddled — pick one (a cool cyan or blue works well against the near-black base) and use it for interactive elements only, not decoration.

### 11.2 Real templates to start from

- **Admin console (Next.js):** the **Next.js shadcn Dashboard Starter** (~6k stars, the most battle-tested, and the reference implementation most other shadcn-based admin templates build on) or **TailAdmin** (free, 500+ prebuilt UI elements, collapsible sidebar, multiple layout variants). Given the admin console needs real-time hardware/locker monitoring and the new terminal feature, evaluate whichever has the better live-data components (status badges, log viewers, real-time tables) — not just whichever looks nicer out of the box.
- **Mobile (Flutter):** browse LogRocket's actively-maintained "free Flutter templates" roundup (updated as recently as March 2026, specifically to stay current in a fast-moving template ecosystem) for a marketplace/rental-style starting point over a generic dashboard template.
- **Remix, don't clone verbatim** — pull structure and component patterns, then apply EngiRent's own tokens (11.1) rather than shipping a template's out-of-the-box branding.
- **Use a Flutter-specific anti-generic-AI-design skill, the same way the web work uses one** — the Flutter template ecosystem has its own version of the "obvious AI slop" problem, and a Claude Code skill built specifically for distinctive, production-grade Flutter UI (avoiding generic Material defaults) exists and is worth installing alongside whatever web design-review skill is already in use, rather than assuming the web-focused skill covers Flutter too.

### 11.3 Loading states and animation — real library choices, not vague "add some polish"

This is where a mobile app most visibly separates "functional" from "feels like a real product," and there's a genuine current (2026) best-practice stack worth naming specifically rather than leaving to chance:

- **Skeleton loading for content (item lists, rental history, item detail pages): use `skeletonizer`, not the older `shimmer` package.** Skeletonizer auto-generates placeholder skeletons from your actual widgets, which means the loading state automatically matches the final layout's exact dimensions — critical, because a skeleton that doesn't match final content dimensions causes a jarring layout jump the moment real data arrives, which is a worse experience than no skeleton at all. `shimmer` still has its place for a simple one-off glow effect, but skeletonizer is the better default across the app.
- **Two-engine animation strategy, not one library for everything:** use **Lottie** for decorative, play-once, or looping animations (splash/loading screens, empty states — "no items yet," success/failure confirmation screens) and **Rive** for interactive, state-driven, multi-state animations (an in-progress auth/verification indicator that needs to visually reflect actual state changes, not just loop). This split is a real, established pattern for exactly the reason it sounds like: Lottie is the right tool for "plays a nice animation," Rive is the right tool for "the animation needs to represent live state."
- **`flutter_animate`** for the simpler, cheap wins — chainable fade/slide/scale transitions on widgets with minimal code, for things like list items animating in or a card transitioning between states.
- **`cached_network_image`** for item photos specifically (this app is fundamentally a photo-driven marketplace) — caches downloaded images locally and supports a placeholder/shimmer-while-loading state plus graceful error handling, rather than a blank gap or a broken-image icon on a slow connection.
- **Where this matters most for EngiRent specifically:** the rental status transition (pending → approved → ready for pickup → returned) is exactly the kind of state change Rive is built for — animate it as a real progression the user watches happen, not a label that silently updates.

### 11.4 Toasts, consistently, across all three surfaces

One toast pattern, used the same way everywhere rather than three ad-hoc implementations:
- **Success** (item listed, rental approved, payment released), **error** (verification failed, payment declined — always specific, never a bare "something went wrong"), **warning** (a rental nearing its return deadline, a locker connectivity issue detected), **info** (background actions — "AI verification in progress").
- Errors and anything touching payment/escrow status should not auto-dismiss quickly — a renter needs to actually see "payment held, pending verification," not have it flash past.
- Flutter's idiomatic equivalent (a well-implemented `SnackBar`/toast package) should keep the same four-category system and tone as web, even though the implementation differs per framework.

### 11.5 Consistency across all surfaces

Confirm rental status, item availability, and notifications actually stay in sync across web, mobile, kiosk, and admin rather than one lagging behind the others — this is as much a data/real-time-sync audit item (section 8's Socket.io check) as a design one; a beautifully redesigned surface showing stale data is not actually fixed.

---

## 12. Full redesign — the physical kiosk touchscreen specifically

This is its own section, separate from 11's general design work, because a kiosk running on a screen bolted to a wall in a hallway is a genuinely different design problem from a web or mobile app — different failure modes, different user assumptions (often first-time, one-off users with zero onboarding), and a hard requirement this section exists specifically to solve: **a user standing at the kiosk mid-verification needs to unambiguously know they cannot walk away yet.**

### 12.1 Two distinct modes, not one screen that tries to do both

- **Attract/idle mode** — when nobody's actively using it, this becomes digital signage: explain what EngiRent is, how the rental flow works, and what's currently available, on a loop. This is a real, well-established category (self-service kiosk UX guidance consistently calls this out): idle/loading screens should reinforce the brand without clutter, use real product imagery rather than stock photos, and keep any animation subtle and functional rather than distracting — this is advertising *for* the system, not a flashy distraction competing with it.
- **Active/interactive mode** — the actual transaction flow (deposit, claim, return), which is a completely different design problem: task-focused, one clear action at a time, minimal decoration.
- Transition between them on touch/QR-scan (idle → active) and after an inactivity timeout (active → idle) — but see 12.4 for the one critical exception to this timeout behavior.

### 12.2 The actual step-by-step flow — build it as a real step wizard, not a series of disconnected screens

Don't build each screen as an independent component reacting to state — use a proper step-wizard pattern (`react-step-wizard` is a real, current, well-established component for exactly this) so the flow has one visible source of truth for "which step am I on" and "what's next," always shown to the user (a persistent "Step 2 of 4" indicator, not just an implicit screen change). Map the actual EngiRent flows into explicit named steps rather than leaving them as an internal state machine no one designed screens around:

- **Deposit flow:** Scan/Face Auth → Verifying Identity ("Please hold still") → Assigned Locker Opens ("Place your item in Locker #3, then press Confirm") → **AI Verification In Progress** ("Checking your item — do not leave, this takes about 15 seconds") → Result (success: "Item deposited, escrow active" / failure: retry or manual-review path, see 12.3) → Receipt/Confirmation → auto-return to idle.
- **Claim/pickup flow:** Scan/Face Auth → Verifying Identity → Locker Opens ("Take your item, then press Confirm") → Confirmation → Receipt → idle.
- **Return flow:** Scan/Face Auth → Verifying Identity → "Place item in Locker #3" → **AI Damage Comparison In Progress** ("Comparing item condition — do not leave yet") → Result (clean return / flagged for review) → Receipt → idle.

Every step that involves the AI service (verification, damage comparison) needs the explicit **"do not leave yet" persistent banner** the request specifically asked for — not a generic spinner. State plainly what's happening, roughly how long it takes, and that walking away now means an incomplete transaction. This directly closes a real gap already flagged in section 3.4/3.5 of this document (retry-exhaustion and dispute-SLA handling) — if verification fails or needs manual review, the screen needs a defined next-step message too ("this needs a quick manual check — you'll get a notification within [X]"), not a dead end.

### 12.3 Every process gap from section 3 needs an actual screen, not just a backend fix

Section 3 flagged several process ambiguities — retry-attempt exhaustion (3.4), facial-recognition fallback (3.6), kiosk-full capacity (3.9). Each of these, once resolved in the backend, needs a corresponding kiosk screen designed for it, or the fix doesn't actually reach the person standing at the kiosk:
- Facial recognition failing needs a visible fallback path on-screen (e.g. a QR + PIN option), not just a backend capability nobody surfaces — this is also where `react-kiosk-keyboard` (a real, current React virtual keyboard built specifically for touchscreen/kiosk use) is directly useful for any on-screen PIN/text entry.
- Retry exhaustion needs an actual "this didn't work, here's what happens next" screen, not a silent failure back to idle.
- A full kiosk needs an explicit "all lockers currently in use, try again in [X] / join waitlist" screen rather than an unexplained rejection.

### 12.4 The one critical interaction between idle-timeout and "do not leave yet"

A standard kiosk returns to its idle/attract screen after a period of inactivity — but during an active AI-verification step, the user is *supposed* to be inactive (they're told not to leave, not to keep touching the screen). **The idle-timeout-to-attract-mode behavior must be suspended during any "do not leave yet" state** — otherwise the kiosk visibly contradicts its own instruction by resetting to the advertising screen while a verification the user was told to wait for is still running. This is a specific, checkable bug class worth testing directly: trigger a verification step, don't touch the screen for the normal idle-timeout duration, and confirm the screen stays on the verification state rather than reverting to attract mode.

### 12.5 Reference points worth studying, not cloning

- **`gigaamiridze/library-kiosk-mobile-app`** — a library self-service kiosk (borrow/return books) with a step flow structurally very close to EngiRent's own deposit/claim/return pattern (category → item → auth → confirmation for borrowing; ID entry → auth → confirmation for returning) — worth reading for how a close-analog use case broke its flow into named steps.
- **`n17foo/open-kiosk`** — a full retail kiosk reference implementation showing a clear sequential transaction pattern (Card Detection → Card Reading → PIN Entry → Authorization → Receipt) — useful for the general discipline of naming every transaction stage explicitly rather than leaving steps implicit in code.
- **`rhulse/kiosk-application-framework`** — an open-source framework built specifically around the idle/interactive-mode split described in 12.1, originally built for museum touchscreen interactives — worth studying for how it separates the two modes structurally, not for its specific visual style.
- The kiosk UX checklist from kioskindustry.org (also mirrored on AVIXA Xchange) is a real, citable industry checklist worth running the finished design against directly: sub-2-second transitions between steps, an offline fallback mode if connectivity drops, no dead-end screens, glare/touch-accuracy testing on the actual hardware, and screen readability from 2–3 feet away for anyone in a queue behind the current user.

---

## 13. Output format

Same disciplined format as any audit — a written report, not silent changes:

```markdown
# EngiRent Hub Audit — [date]

## Summary
[X Critical, X High, X Medium, X Low findings]

## Findings
### [Severity] Short title
- **Where:** file/component/hardware element
- **What's wrong:**
- **Fix:** [applied automatically | needs your input — why]
```

Findings in sections 4 (biometric/privacy), 5 (payment/escrow), and 6 (hardware/physical safety) get surfaced explicitly at the end of the audit response as needing your review, regardless of how mechanical the fix might look — these are the three categories where "I fixed it automatically" isn't good enough on its own.