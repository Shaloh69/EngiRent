# EngiRent Hub — Design Mandate (Full Scrap & Remake)

This is a directive, not a menu of suggestions. The existing design across all three client surfaces — Phone App, Admin Console, Kiosk — is to be **completely scrapped and rebuilt**, not incrementally restyled. Fold this into the EngiRent revamp master prompt's design phase once `documentation.md` exists. Every decision below is final unless explicitly marked as a question for the user.

**Corrections from the real audit (documentation.md), read before applying §1's animation stack:** the three surfaces map onto real code as `client/admin` (Admin Console), `client/flutter_app` (Phone App), and `server/kiosk/kiosk_ui` (Kiosk) — but the Kiosk is **Flask + vanilla JS, not React**. §1's animation stack (Framer Motion, React Three Fiber, react-bits) is React-oriented and does not drop into the kiosk as-is — see `EngiRent_03_REVAMP_MASTER.md` §6 for the two real options (migrate the kiosk to a small React build, or use vanilla-JS-compatible equivalents) and resolve that question before starting the Kiosk section below. There is also a real, EngiRent-branded fourth surface, `client/web`, not accounted for by this document's three-surface model — its inclusion in this design pass is a separate open question, also in the master prompt's Phase 2.

---

## 0. Non-negotiable process — a design doc alone is not enough

A previous project's design work looked correct on paper but the shipped UI was generic and unstyled anyway — the design intent was never actually enforced against what got built. **That does not happen here.** This phase is not complete when the code is written; it is complete when a screenshot of the running app proves it matches this document.

**This exact failure already happened once on this project, despite this section existing.** `DESIGN.md` reported the Admin Console Dashboard as built and screenshot-verified — real Mantine `BarChart`, real palette, real Cmd+K shell. Live screenshots of the actual running app (login page and dashboard, both reachable via the real Cloudflare tunnel URL) show: no chart present at all, the "Secure Admin Login" heading barely legible against its own background (a real contrast failure), sidebar nav text nearly invisible, and the palette reading as generic light-cards-on-dark rather than the mandated violet/amber/coral system — amber and coral don't appear anywhere on either screen. Whatever the prior verification loop checked, it didn't catch any of this. **Before redoing this work, explain what the verification loop actually did last time and why it didn't catch a missing component and unreadable text** — otherwise there's no reason the next "verified" pass is any more trustworthy than this one was.

**Mandatory loop, per surface, per major screen — hardened after the above, no exceptions:**
1. Build the screen.
2. Take an actual screenshot **of the real, currently-deployed instance** — the same URL/build a person would actually reach (the live Cloudflare tunnel, or whatever `Start.bat` actually serves), not a local dev server or a branch that might diverge from what's really running. A screenshot of the wrong build proves nothing.
3. Compare that screenshot against this document's spec for that surface, checking each of these explicitly rather than an impression of "looks styled":
   - **Contrast**: every piece of text must be legible at a glance — no gray-on-dark or gray-on-light combinations that require squinting. If in doubt, check it, don't eyeball it.
   - **Palette**: teal primary, gold secondary, coral tertiary must all actually be visible somewhere on the screen — not just teal used once for a nav highlight while everything else defaults to generic gray/white/blue.
   - **Every component named in this document's spec for that screen is actually present and rendering** — not just present in the code, rendering, with real or realistic placeholder data if live data is empty. An empty-state table row is fine; a missing chart entirely is not.
4. If it doesn't match on any of the above — fix it and re-screenshot against the real deployed instance again. Repeat until it matches.
5. Only then move to the next screen.

**Deliverable: `DESIGN.md` at the repo root**, containing:
- The full design system (tokens, palette, typography, motion) as actually implemented — not aspirational.
- A **before/after comparison section per surface** — the old screenshot (or a description of the prior state if screenshotting the old version isn't practical) next to the new one, for Phone App, Admin Console, and Kiosk each. Both screenshots must be of real running instances, per the hardened loop above.
- A short rationale per surface: what changed and why, useful for the thesis write-up.

Do not report a surface as "done" without the screenshots to back it up in `DESIGN.md`. This is the enforcement mechanism — treat it as a hard gate, not documentation busywork.

---

## 1. Foundation — shared across all four surfaces (Phone App, Admin Console, Kiosk, and `client/web`)

**Delete first, then rebuild — this is not a restyle.** For every screen in scope across all four surfaces: delete the existing component/page code rather than editing it in place. Building fresh against this spec produces a cleaner result than trying to incrementally patch old markup into matching a completely different visual language — and it removes any risk of old, half-matching styles bleeding through. This also applies to the Admin Console specifically, where the last pass left old and new styling mixed on the same page — that ambiguity doesn't happen again if the old code is gone, not just overridden.

**Add more, don't just reskin what's there.** Every surface's screen/component list in this document is a floor, not a ceiling — where a screen could reasonably use an additional component (a stat card, a secondary chart, an empty-state illustration, a related-items rail), add it. The goal is a genuinely fuller product, not the same page count in nicer colors.

- **Component base: Mantine.** Not HeroUI, not a HeroUI reskin. Genuinely different theming architecture (prop-driven, not TailwindVariants), 120+ components, strong dark mode support needed for the Kiosk's dark theme (§4 of the palette section below). This applies to Admin Console and Kiosk (once migrated); `client/web` uses a different, deliberately separate stack — see §3.5.
- **Animation/3D layer, layered on top of Mantine — this is where "beautiful" actually comes from:**
  - **Framer Motion** — page/element transitions, micro-interactions, everywhere.
  - **Spline** (fastest path to real 3D, designer-friendly, exports a ready React component) or **React Three Fiber + drei** if the 3D needs to be more data-driven — for the rotating 3D lock and item-preview elements.
  - **Lottie** (`lottie-react` for web/kiosk, `lottie_flutter` for the phone app — same JSON files reused across all three surfaces) — thousands of free, ready-to-use lock/unlock/key animations confirmed available on LottieFiles and IconScout. Do not hand-animate these from scratch.
  - **react-bits** — animated backgrounds (same tool already validated for the sibling Road Sentinel project; framework-agnostic, no registry lock-in).
  - **Rive** (Flutter-specific, phone app only) — for the lock icon to have a real state machine (locked → unlocking → unlocked), not just a fire-and-forget clip.

- **Color palette — pivoted, and here's why.** The prior palette (violet primary) is being replaced, not just re-enforced — when it actually shipped, it rendered as a generic blue button and a mostly colorless UI, which is exactly the failure mode of relying on the single most common SaaS brand color (over 70% of SaaS products default to blue/violet). **New palette: "EngiRent Vault"** — deep teal/emerald as primary, distinctive rather than generic, still reads as trustworthy/secure (validated as a genuine alternative to blue for exactly that purpose), and pairs naturally with gold for the literal lock-and-key motif:

| Role | Color | Hex |
|---|---|---|
| Primary/brand | Deep Teal/Emerald | `#0D9488` |
| Secondary — literal "key" accent | Gold | `#F5A623` |
| Tertiary — CTA energy | Coral | `#FB7185` |
| Success / available / escrow released | Emerald (distinct shade from brand primary) | `#22C55E` |
| Warning / pending / due soon | Amber (distinct shade from brand secondary) | `#F59E0B` |
| Critical / overdue / dispute / damage | Red | `#EF4444` |

**All three brand colors (teal, gold, coral) must be visibly present on every major screen** — not one used once for a nav highlight while everything else defaults to library gray. This is now an explicit item in §0's verification checklist; treat "only one brand color visible" as a fail condition, the same as a missing component.

Two modes, not one theme stretched across contexts: **"Campus Day"** (warm off-white, not stark `#FFFFFF`) for Phone App, Admin Console, and `client/web`; **"Vault"** (near-black, deliberate dark mode) for the Kiosk specifically — the dark background is what makes the 3D lock and accent colors actually pop on a public always-on display.

---

## 2. Phone App

**Explicit template references, with real links — pull actual structure and screen inventory from these, don't design from a blank page:**
- **["Car Rental Mobile App UI Kit"](https://www.figma.com/community/file/1186908585660114642/car-rental-mobile-app-ui-kit-figma-community)** (Figma Community) — closest real structural analog with both light and dark versions already built and fully editable components — use its screen flow and component patterns even though the vertical differs (cars vs. campus equipment).
- **["Rental App UI Kit"](https://www.freefigmatemplates.com/gallery/rental-app-ui-kit)** (freefigmatemplates.com, free, 14 screens) — opening screen, login, registration, rental detail, booking, chat/help, profile. Already uses a purple/violet accent as its primary interactive color; re-theme it to the new teal/gold/coral palette above rather than keeping its default.
- **["Properties & Rental App Mini UI Kit"](https://www.figma.com/community/file/1041987118247062951/properties-rental-app-mini-ui-kit)** (Figma Community) — reference for its browse/listing-detail pattern specifically.

**What the app must have (mandatory screen list — a floor, not a ceiling; add more where a screen would clearly benefit):**
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
- **[Mantine Analytics Dashboard](https://github.com/design-sparx/mantine-analytics-dashboard)** (free, open source, Next.js 16 + React + Mantine 8 + TypeScript — hundreds of UI components, forms, tables, ApexCharts, Mantine DataTable) — the primary structural reference, since it's built on the exact component base mandated in §1. Use its layout, navigation, and page architecture directly as a starting skeleton. (A slightly older alternative if this one's too new/unstable in practice: [qqharry21/nextjs-mantine-dashboard](https://github.com/qqharry21/nextjs-mantine-dashboard), Mantine 7, more established at 290+ stars.)
- **[TailAdmin](https://github.com/TailAdmin/free-nextjs-admin-dashboard)** (Tailwind-based, but reference for *page inventory and component patterns* regardless of underlying library — 500+ UI elements, seven dashboard variations including CRM, logistics, marketing) — use as a checklist of "what pages/widgets exist in a serious admin panel," not as a code source, since it's a different component library than what's mandated here.

**What a console for this specific product must have — this is not generic dashboard advice, this is EngiRent-specific:**
- **Overview/analytics dashboard** — KPI cards (active rentals, revenue this period, pending disputes, kiosk uptime), charts for rental volume and popular categories over time, recent activity feed. **A chart must actually render** — an empty-data state should still show the chart shell, not omit the component entirely.
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

## 3.5 `client/web` — Promotional Website

New, dedicated section — this surface previously had no template reference of its own. `client/web` is a **marketing/promotional site**, not an app surface — treat it as a genuinely different design problem than the other three: it needs hero sections, feature showcases, and conversion-oriented layout patterns, not dashboard or form patterns.

**Explicit template reference, with real link:** **[Velora UI](https://github.com/ColorlibHQ/velora-ui)** (also browsable live at [velora.colorlib.com](https://velora.colorlib.com/)) — free, MIT-licensed, Next.js 16 + Tailwind CSS 4 + Motion, ships a complete multi-page site (home, pricing, blog with MDX, about, contact, login/signup, changelog, 404) built from 32+ animated components, including an aurora hero background component installable directly via the shadcn CLI (`npx shadcn@latest add https://velora.colorlib.com/r/aurora-background.json`). This is a genuinely strong fit for two reasons at once: it's a real, complete promotional-site template with real pages to adapt rather than build from scratch, and its animated aurora background is the same category of component already mandated for the Kiosk's idle screen — reusing the same visual technique here (re-themed to the teal/gold/coral palette) gives the whole product a consistent animated-background language across surfaces instead of a one-off.

**Note on tooling: this is a deliberate exception to the "Mantine everywhere" rule.** `client/web` doesn't share components with the app surfaces and isn't part of the same user session — using Velora UI's shadcn/ui-based stack here doesn't conflict with Admin Console's Mantine base, since nothing crosses between them. Don't try to reconcile the two component systems; they're intentionally separate.

**Pages/sections to build, using Velora UI's real page set as the starting skeleton:**
- Home — hero (with the animated aurora background, re-themed), feature showcase (the actual EngiRent workflow: list → request → deposit at kiosk → verify → pickup → return), how-it-works walkthrough, testimonials/social proof if any exist, footer
- Pricing — if EngiRent's fee structure is public-facing (check against `documentation.md`'s confirmed fee model)
- About — academic/thesis context, team
- Blog — if there's real content to populate it with; don't ship an empty blog with placeholder posts
- Contact
- Login/signup — linking through to the real Admin Console or Phone App as appropriate, not a duplicate auth system
- Docs — `documentation.md` confirmed a real, accurate `/docs` section already exists with four genuinely accurate sections; carry that content forward into the new design rather than discarding it

---

## 4. Kiosk


**Explicit template references:**
- **["Self Service Kiosk"](https://www.figma.com/community/file/1475972798185896799/self-service-kiosk)** (Figma Community) — general self-service touchscreen interaction patterns, accessibility-considered.
- **["Home Screen Design for Dodo Pizza's Self-Service Kiosk"](https://www.figma.com/community/file/1446517148275617940/home-screen-design-for-dodo-pizzas-self-service-kiosk)** (Figma Community) — specifically useful for its structural pattern: a fixed vertical sidebar categorizing offerings with bold icons and an active-category highlight, staying consistent through the whole flow. This maps directly onto EngiRent's item categories and is a proven, real pattern, not an invented one.
- **["Interactive and Accessible Product Card Design for a Self-Service Kiosk"](https://www.figma.com/community/file/1446514995844693138/interactive-and-accessible-product-card-design-for-a-self-service-kiosk)** (Figma Community, same Dodo Pizza series as above) — reference for the item-card pattern specifically: how a single item is presented, selected, and confirmed on a touchscreen, with accessibility considered.

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