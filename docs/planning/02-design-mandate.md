# EngiRent Hub — Design Mandate (Full Scrap & Remake)

This is a directive, not a menu of suggestions. The existing design across all three client surfaces — Phone App, Admin Console, Kiosk — is to be **completely scrapped and rebuilt**, not incrementally restyled. Fold this into the EngiRent revamp master prompt's design phase once `documentation.md` exists. Every decision below is final unless explicitly marked as a question for the user.

**Corrections from the real audit (documentation.md), read before applying §1's animation stack:** the three surfaces map onto real code as `client/admin` (Admin Console), `client/flutter_app` (Phone App), and `server/kiosk/kiosk_ui` (Kiosk) — but the Kiosk is **Flask + vanilla JS, not React**. §1's animation stack (Framer Motion, React Three Fiber, react-bits) is React-oriented and does not drop into the kiosk as-is — see `EngiRent_03_REVAMP_MASTER.md` §6 for the two real options (migrate the kiosk to a small React build, or use vanilla-JS-compatible equivalents) and resolve that question before starting the Kiosk section below. There is also a real, EngiRent-branded fourth surface, `client/web`, not accounted for by this document's three-surface model — its inclusion in this design pass is a separate open question, also in the master prompt's Phase 2.

---

## 0. Non-negotiable process — a design doc alone is not enough

A previous project's design work looked correct on paper but the shipped UI was generic and unstyled anyway — the design intent was never actually enforced against what got built. **That does not happen here.** This phase is not complete when the code is written; it is complete when a screenshot of the running app proves it matches this document.

**Mandatory loop, per surface, per major screen — no exceptions:**
1. Build the screen.
2. Take an actual screenshot of it running (Playwright for web/kiosk, a simulator/device screenshot for the Flutter app — not a description of what it should look like).
3. Compare that screenshot against this document's spec for that surface, side by side.
4. If it doesn't match — generic cards, default component styling, missing animation, wrong palette, flat/lifeless — fix it and re-screenshot. Repeat until it matches.
5. Only then move to the next screen.

**Deliverable: `DESIGN.md` at the repo root**, containing:
- The full design system (tokens, palette, typography, motion) as actually implemented — not aspirational.
- A **before/after comparison section per surface** — the old screenshot (or a description of the prior state if screenshotting the old version isn't practical) next to the new one, for Phone App, Admin Console, and Kiosk each.
- A short rationale per surface: what changed and why, useful for the thesis write-up.

Do not report a surface as "done" without the screenshots to back it up in `DESIGN.md`. This is the enforcement mechanism — treat it as a hard gate, not documentation busywork.

---

## 1. Foundation — shared across all three surfaces

- **Component base: Mantine.** Not HeroUI, not a HeroUI reskin. Genuinely different theming architecture (prop-driven, not TailwindVariants), 120+ components, strong dark mode support needed for the Kiosk's dark theme (§4 of the palette section below).
- **Animation/3D layer, layered on top of Mantine — this is where "beautiful" actually comes from:**
  - **Framer Motion** — page/element transitions, micro-interactions, everywhere.
  - **Spline** (fastest path to real 3D, designer-friendly, exports a ready React component) or **React Three Fiber + drei** if the 3D needs to be more data-driven — for the rotating 3D lock and item-preview elements.
  - **Lottie** (`lottie-react` for web/kiosk, `lottie_flutter` for the phone app — same JSON files reused across all three surfaces) — thousands of free, ready-to-use lock/unlock/key animations confirmed available on LottieFiles and IconScout. Do not hand-animate these from scratch.
  - **react-bits** — animated backgrounds (same tool already validated for the sibling Road Sentinel project; framework-agnostic, no registry lock-in).
  - **Rive** (Flutter-specific, phone app only) — for the lock icon to have a real state machine (locked → unlocking → unlocked), not just a fire-and-forget clip.

- **Color palette — "EngiRent Spectrum," mandatory across all three surfaces:**

| Role | Color | Hex |
|---|---|---|
| Primary/brand | Violet/Indigo | `#7C3AED` |
| Secondary — literal "key" accent | Amber/Gold | `#F5A623` |
| Tertiary — CTA energy | Coral/Pink | `#FB7185` |
| Success / available / escrow released | Emerald | `#10B981` |
| Warning / pending / due soon | Amber (distinct shade from brand secondary) | `#F59E0B` |
| Critical / overdue / dispute / damage | Red | `#EF4444` |

Two modes, not one theme stretched across contexts: **"Campus Day"** (warm off-white, not stark `#FFFFFF`) for Phone App + Admin Console; **"Vault"** (near-black, deliberate dark mode) for the Kiosk specifically — the dark background is what makes the 3D lock and accent colors actually pop on a public always-on display.

---

## 2. Phone App

**Explicit template references — pull real structure and screen inventory from these, don't design from a blank page:**
- **"Tool Rental Mobile App UI Kit"** (Figma Community, via UI Workshop) — the closest direct analog: renting tools/equipment/hardware, which is exactly EngiRent's item category set (calculators, drawing tools, Arduino kits). Use its screen flow and layout patterns as the primary structural reference.
- **Free "Rental App UI Kit"** (freefigmatemplates.com, 14 screens) — opening screen, login, registration, rental detail, booking, chat/help, profile. Notably already uses a purple accent as its primary interactive color — directly compatible with the mandated palette above, minimal adaptation needed.
- **RentQu — Rental Car UI Kit** (Figma Community) — reference for its light/dark theme pairing specifically, since the app needs both "Campus Day" and any dark-mode toggle done properly.

**What the app must have (mandatory screen list, not exhaustive — add more as needed, don't have fewer):**
- Onboarding/login (student email verification, given this is UCLM-only)
- Browse/marketplace home — category grid (School Attire, Academic Tools, Electronics, Development Kits, Measurement Tools, Audio/Visual, Sports), search, filters
- Item detail page — photos, price, availability calendar, owner rating, "Request Rental" CTA
- Rental request/checkout flow — duration picker, cost breakdown, PayMongo checkout (GCash/Maya/card), escrow explanation
- Active rentals — status tracking (pending approval → confirmed → ready for pickup → in use → return due → returned), with the lock/key Lottie animation reflecting state
- Kiosk pickup/return flow — QR code display for scanning at the kiosk, live status once at the kiosk
- Owner-side: list an item, manage listing, approve/reject requests, view earnings
- Notifications feed
- Chat with the other party in a rental
- Profile — rating history, rental history, saved payment info
- Rating/review screen after a completed rental

**Animation mandate for the phone app specifically:** every state transition in the active-rental flow (pending → confirmed → ready → returned) should have a corresponding Lottie/Rive animation, not a static status badge. This is the app's core emotional moment — reducing anxiety about "is my stuff safe" — treat it accordingly, not as an afterthought.

---

## 3. Admin Console

**Explicit template references:**
- **Mantine Analytics Dashboard / Mantine-Admin Dashboard** (Next.js + Mantine + TypeScript, free, open source) — the primary structural reference, since it's already built on the same component base mandated in §1. Use its layout, navigation, and page architecture directly as a starting skeleton.
- **TailAdmin** (Tailwind-based, but reference for *page inventory and component patterns* regardless of underlying library — 500+ UI elements, seven dashboard variations including CRM, logistics, marketing) — use as a checklist of "what pages/widgets exist in a serious admin panel," not as a code source, since it's a different component library than what's mandated here.

**What a console for this specific product must have — this is not generic dashboard advice, this is EngiRent-specific:**
- **Overview/analytics dashboard** — KPI cards (active rentals, revenue this period, pending disputes, kiosk uptime), charts for rental volume and popular categories over time, recent activity feed
- **User management** — table of all users (students/owners/renters), verification status, flagging/suspension actions, per-user detail page (rental history, rating, reported issues)
- **Item/listing management** — moderation queue for new listings, category management, flagged-item review
- **Rental transaction management** — sortable/filterable table of all rentals, drill-down detail page per rental (full timeline: requested → approved → paid → deposited → verified → claimed → returned), with the AI verification confidence score and before/after images shown inline for any AI-verification step
- **Dispute resolution queue** — a dedicated, prioritized queue specifically for AI-verification failures and user-reported issues, since the README frames this as a defined admin responsibility — don't bury it inside the general rental table
- **Kiosk/hardware monitoring** — real-time locker status per compartment (empty/occupied/faulted), kiosk online/offline state, camera health. No conveyor monitoring needed — confirmed by the audit that no conveyor hardware or "auto-move unclaimed items" mechanism exists anywhere in the code, despite being a documented headline feature in older docs.
- **Financial reports** — payment tracking, revenue analytics, refund/escrow-release logs, exportable
- **Settings** — fee/penalty configuration (late fee rates, damage penalty rules), category management, notification templates
- **Command palette (Cmd+K)** — modern admin-panel convention, worth including given the console will have many entity types to jump between
- **Auth** — role-based (student/owner vs. admin vs. super-admin if warranted), not just a single admin password

---

## 4. Kiosk

**Explicit template references:**
- **"Self Service Kiosk"** (Figma Community) — general self-service touchscreen interaction patterns, accessibility-considered.
- **"Home Screen Design for Dodo Pizza's Self-Service Kiosk"** (Figma Community) — specifically useful for its structural pattern: a fixed vertical sidebar categorizing offerings with bold icons and an active-category highlight, staying consistent through the whole flow. This maps directly onto EngiRent's item categories and is a proven, real pattern, not an invented one.
- **"kiosk UI/UX case study"** (Figma Community) — bold visuals, intuitive layouts, quick workflows for busy/public environments.

**What the kiosk must do — the idle screen and the active flow are two different design problems, treat them as such:**

**Idle/"attract loop" (this is the industry-standard term — use it in code/docs):**
- Triggers automatically after a timeout of no interaction.
- 30-60 second looping sequence of scenes, not one static animation — cycle through a few.
- Deliberately more vibrant and animated than the rest of the kiosk flow — this is the one place where more visual energy is correct, industry guidance is explicit about this.
- Must include: the 3D lock animation (unlocking to reveal rotating item-category icons — ties "lock and key" and "rental" together visually), and a periodic, unmissable **"Tap to Start"** prompt with a tap/hand icon animation — a static touchscreen does not read as touch-enabled to someone walking past without an explicit cue.
- Reinforces what EngiRent *is* during this loop (brief, rotating messaging), not just decoration.

**Active-use flow (once someone taps in) — must go calm and task-focused, this is the opposite design mode from the idle screen:**
- QR scan → facial recognition confirmation → locker assignment → item verification (camera capture + AI check, with a clear progress/waiting state) → confirmation screen with the Lottie "unlocked" animation.
- Minimum touch target ~20mm physical size — calculate the actual px equivalent once the real touchscreen spec is confirmed in the hardware audit.
- Timeout-triggered return to idle if abandoned mid-flow, not just from the home screen.
- **Offline fallback state** — a kiosk that freezes or shows a raw API error on a lost connection is a much worse failure than the same failure in a phone app; this needs an explicit, designed "temporarily unavailable, please use the app" state, not a blank screen.

---

## 5. Sequencing

This document assumes the same overall structure as the Road Sentinel revamp: audit first (`EngiRent_01_audit_prompt.md` → `documentation.md`), then a master revamp prompt built from that audit, with this document's design phase folded in as a **mandatory full rebuild**, not an optional enhancement — surfaced clearly in the master prompt as such. If the audit reveals the mobile app isn't actually Flutter, or `client/`/`server/` don't map the way assumed here, adjust the implementation details accordingly — the mandate (scrap everything, rebuild per this spec, prove it with screenshots in `DESIGN.md`) does not change.