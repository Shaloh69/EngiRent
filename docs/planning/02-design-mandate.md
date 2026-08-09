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
   - **Palette**: cerulean primary, brass secondary, coral tertiary must all actually be visible somewhere on the screen — not just the primary used once for a nav highlight while everything else defaults to generic gray/white.
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

### 1.0 Named aesthetic direction — commit to this one, don't average across all of them

**Direction: "Machined Vault" — engineering instrument, not SaaS dashboard.**

The reference objects are the things these students actually handle: a Vernier caliper, an oscilloscope faceplate, a machined aluminium enclosure, a blueprint, a brass padlock. Precise, dense, high-contrast, built for reading at a glance under bad lighting. **Not** friendly-startup, not soft-and-rounded, not pastel.

Adjectives to design toward: *machined, instrument-grade, dense, deliberate, legible, engineered.*
Anti-examples to design away from: *airy, playful, bubbly, "clean minimal SaaS", Linear-clone, Stripe-clone.*

**Why this section exists:** a generic direction produces generic output. Without one named direction, the fallback is the aggregate of every well-designed interface ever seen — which is exactly the failure this document already caught once. Pick this direction and apply it consistently; do not blend it with a second one.

### 1.1 Banned by default — these are the specific tells of machine-generated UI

Each of these is a **fail condition** in §0's verification checklist, not a preference. Every one is present in some form in the current build; that's the point.

| Banned | Use instead |
|---|---|
| **Inter, Geist, or system-default sans** as the primary typeface | The type stack in §1.2 — Inter in particular is the single most common tell |
| **Default** blue/indigo as primary — Tailwind `blue-600` `#2563EB`, `blue-500` `#3B82F6`, `indigo-500` `#6366F1` and their neighbours (hue 220-245) | Cerulean `#0B5FA5`, hue ~205 (§1.3b). **Blue itself is not banned.** The tell is the *default* swatch reached for without thought, not the hue family. A blue chosen deliberately and kept away from those defaults is a legitimate brand decision. |
| Border-radius above **6px** on cards/buttons/inputs; pill-shaped buttons | 2px (inputs, chips), 4px (buttons), 6px (cards/panels) — machined edges, not lozenges |
| Multi-layer / soft "elevation" drop shadows | A single 1px border in a palette tint, plus at most one hard low-opacity shadow |
| Full-width hero with centred headline + subheadline + one CTA | Asymmetric split layouts, off-centre composition, real content in the second column |
| Icon-grid "features" section (3 or 4 identical icon+title+blurb cards) | A real sequenced walkthrough, a labelled diagram, or a comparison table |
| Testimonial carousel; three-column footer link farm | Omit unless real content exists — do not ship placeholder testimonials |
| Uniform 50px+ padding everywhere | The 8px scale in §1.4, varied deliberately by density |
| Generic gray `#6B7280`-family neutrals | Palette-tinted neutrals (§1.3) so gray reads as part of the brand, not a library default |

### 1.2 Typography — exact families, no substitutions

Three families, each with a distinct job. All three are on Google Fonts and available to Flutter via `google_fonts`, so every surface can use the identical stack.

| Role | Family | Weights | Used for |
|---|---|---|---|
| Display / headings | **Space Grotesk** | 500, 700 | Screen titles, section headers, KPI numbers, hero type. Technical/geometric character with quirks that read as engineered rather than neutral |
| Data / numerals | **IBM Plex Mono** | 400, 600 | IDs, locker numbers, timers, currency amounts, transaction refs, countdowns, anything tabular. IBM Plex was literally drawn for technical work |
| Body / UI | **Manrope** | 400, 500, 600 | Paragraphs, labels, buttons, form fields, table body |

**Every monetary amount, rental ID, locker number, and countdown must be set in IBM Plex Mono.** This is the single cheapest, highest-impact move that makes the product read as an instrument rather than a template — do not skip it.

### 1.3 Palette

- **Component base: Mantine.** Not HeroUI, not a HeroUI reskin. Genuinely different theming architecture (prop-driven, not TailwindVariants), 120+ components, strong dark mode support needed for the Kiosk's dark theme (§4 of the palette section below). This applies to Admin Console and Kiosk (once migrated); `client/web` uses a different, deliberately separate stack — see §3.5.
- **Animation/3D layer, layered on top of Mantine — this is where "beautiful" actually comes from:**
  - **Framer Motion** — page/element transitions, micro-interactions, everywhere.
  - **Spline** (fastest path to real 3D, designer-friendly, exports a ready React component) or **React Three Fiber + drei** if the 3D needs to be more data-driven — for the rotating 3D lock and item-preview elements.
  - **Lottie** (`lottie-react` for web/kiosk, `lottie_flutter` for the phone app — same JSON files reused across all three surfaces) — thousands of free, ready-to-use lock/unlock/key animations confirmed available on LottieFiles and IconScout. Do not hand-animate these from scratch.
  - **react-bits** — animated backgrounds; see §1.5 for the exact per-surface assignment.
  - **Rive** (Flutter-specific, phone app only) — for the lock icon to have a real state machine (locked → unlocking → unlocked), not just a fire-and-forget clip.

- **Color palette — pivoted, and here's why.** The prior palette (violet primary) is being replaced, not just re-enforced — when it actually shipped, it rendered as a generic blue button and a mostly colorless UI, which is exactly the failure mode of relying on the single most common SaaS brand color (over 70% of SaaS products default to blue/violet). **Superseded — see §1.3b for the current "EngiRent Blueprint" palette. Retained for the reasoning.** Former palette: "EngiRent Vault" — deep teal/emerald as primary, distinctive rather than generic, still reads as trustworthy/secure (validated as a genuine alternative to blue for exactly that purpose), and pairs naturally with gold for the literal lock-and-key motif:

| Role | Color | Hex |
|---|---|---|
| Primary/brand | Deep Teal/Emerald | `#0D9488` |
| Secondary — literal "key" accent | Gold | `#F5A623` |
| Tertiary — CTA energy | Coral | `#FB7185` |
| Success / available / escrow released | Emerald (distinct shade from brand primary) | `#22C55E` |
| Warning / pending / due soon | Amber (distinct shade from brand secondary) | `#F59E0B` |
| Critical / overdue / dispute / damage | Red | `#EF4444` |

**All three brand colors (teal, gold, coral) must be visibly present on every major screen** — not one used once for a nav highlight while everything else defaults to library gray. This is now an explicit item in §0's verification checklist; treat "only one brand color visible" as a fail condition, the same as a missing component.

**Palette-tinted neutrals, not library gray.** Every surface, border, and muted-text neutral is mixed toward the teal primary rather than taken from a default gray ramp. Reference values (light mode): surface `#FFFFFF`, app background `#FDFBF7` ("Campus Day" warm off-white, never stark white), border `#D9ECE8`, muted text `#55706B`, ink `#0F2622`. Dark mode: app background `#071310`, surface `#0E1F1B`, border `#1E3B35`, muted text `#7FA39C`, ink `#EAF5F2`.

### 1.4 Spacing, radius, borders

- **8px base grid, no exceptions.** Every margin, padding, and gap is a multiple of 8 (4px permitted only for icon-to-label gaps and inline chip padding). Arbitrary values like 13px/22px/37px are the fastest tell of generated layout — if a value isn't on the scale, it's wrong.
- **Radius scale, hard cap 6px**: 2px inputs/chips/badges · 4px buttons · 6px cards/panels/modals. Nothing is fully rounded except avatars and status dots.
- **Borders do the work shadows used to.** 1px, palette-tinted. At most one shadow token exists (`0 1px 2px rgba(7,19,16,.06)`); there is no elevation ladder.

### 1.3b Palette — "EngiRent Blueprint" (supersedes "Vault")

The teal/gold/coral "Vault" palette is retired. The identity is now blue-led, on the user's direction.

| Role | Light | Dark | Notes |
|---|---|---|---|
| Primary | `#0B5FA5` | `#4DA3E8` | Cerulean / process blue, **hue ~205** |
| Secondary | `#E9A13B` | `#F5B85C` | Brass — the classic complement to blueprint blue |
| Tertiary | `#EF6E7B` | `#FF8A95` | Coral, retained as the alert accent |
| Background | `#F7F9FC` | `#050F1A` | |
| Surface | `#FFFFFF` | `#0B1A2A` | |
| Soft surface | `#EEF4FB` | `#122740` | |
| Border | `#D5E3F2` | `#1E3A54` | |
| Ink | `#0C1F33` | `#EEF6FF` | |
| Muted | `#51677F` | `#93AEC9` | |

**Hue ~205 is the whole point.** Tailwind `blue-600` sits at hue ~221 and `indigo-500` at ~239; those are the swatches §1.1 bans, and they are what "AI-generated blue" actually looks like. 205 reads as cerulean/process blue — an engineering-drawing blue, not a SaaS-template blue. **Do not drift the primary toward 220+.**

**Two hard rules that follow from this palette:**

1. **The light primary may never be used on a dark ground.** `#0B5FA5` on `#050F1A` is roughly **2.4:1** — it reads as a dark smudge, not as a brand colour. Dark mode takes the lifted hues in the table above. This applies to *everything* tinted by the brand, including animated-background colour stops, glow tokens, and focus rings — not just text and buttons.
2. **The Kiosk is permanently dark and therefore always uses the dark column.** It has no light mode (§1.6), so its `theme.css` is built entirely from the lifted values.

Neutrals are blue-tinted, not grey and not teal-tinted, so surfaces sit *under* the primary rather than fighting it.

---

### 1.5 Animated backgrounds — mandatory, one named component per surface

Static flat backgrounds are a fail condition on the screens listed below. Use **[react-bits](https://reactbits.dev)** for the three web surfaces — its registry serves raw source (`https://reactbits.dev/r/<Name>-JS-CSS.json`), so components are vendored into the repo as real files, not added as an opaque dependency.

| Surface | Component | Renderer | Where it appears |
|---|---|---|---|
| `client/web` | **Aurora** | WebGL (`ogl`, ~30KB) | Hero section, full-bleed behind the fold |
| Admin Console | **Aurora** (login, full-bleed) + **Squares/Waves** (app shell, very low opacity) | WebGL + canvas2d | Login screen; subtle grid drift behind the dashboard |
| Kiosk | **Aurora** | WebGL (`ogl`) | Idle attract-loop and success screens |
| Phone App | `AnimatedMeshGradient` (Flutter, `mesh_gradient` pkg) — react-bits is React-only | Fragment shader | Login/register/onboarding, and behind the active-rental status hero |

**Hard constraints on all of them:**
- **Never behind body copy or tabular data at full strength.** Backgrounds sit behind hero/auth/idle content, or at ≤8% opacity behind dense screens. Legibility beats decoration every time — a beautiful background that costs contrast is a §0 fail.
- **`prefers-reduced-motion` must freeze the animation** to a static first frame on every surface.
- **WebGL must degrade gracefully.** If context creation fails, fall back to a CSS gradient rather than rendering a blank rectangle. The Kiosk runs on Raspberry Pi hardware that this repo cannot currently test against — assume it may fail and handle it.

### 1.6 Light and dark modes — required on three of four surfaces

**Phone App, Admin Console, and `client/web` must each ship both a light and a dark theme, with a user-facing toggle** that persists across reloads/restarts and defaults to following the OS setting.

**The Kiosk is deliberately excluded** and stays permanently dark ("Vault"): it is a fixed public display in one known lighting environment, has no per-user preference to persist, and its dark background is what makes the accents and 3D lock read from a distance.

Both modes are first-class — dark is not "the light theme with inverted grays." Each mode has its own surface/border/muted values (§1.3). **Both modes must be screenshot-verified separately** under §0; a surface verified only in light mode is not verified. This is exactly how the last dark-mode failure shipped: light-mode Cards left on hardcoded white while the page background followed the OS to near-black.

---

### 1.7 Text scaling and device variation — layouts must survive both

Reported from the field on v1.4.0: on other people's phones "the texts are too big and scrollable." That was not a font-size choice, it was a layout failure. Android's display **Font size** setting scales every label — up to 2.0x on stock Android, further on some Samsung/Xiaomi skins — and layouts built around fixed heights and fixed aspect ratios clip, stripe, or spill when it moves. A design verified only at the default scale on one device is **not verified**.

Three rules, all mandatory:

**1. Clamp the scale, never ignore it.** `MaterialApp.builder` wraps the tree in a `MediaQuery` whose `textScaler` is clamped to **0.9–1.3**. Honouring scale up to 1.3x covers the large majority of people who enlarge text for genuine legibility reasons; the cap is what keeps layouts intact at the extremes. Never pin the scaler to 1.0 — that overrides an accessibility setting outright and is not an acceptable fix.

**2. Never encode a text block's height as a constant or an aspect ratio.** This is the specific bug that shipped. Product grids used `childAspectRatio: 0.63`, a number tuned by eye at one scale on one screen width; when the title wrapped to a second line the tile could not grow and the price and deposit lines were cut off. Grids must compute `mainAxisExtent` from the actual content — image ratio plus the sum of the text line boxes run through the active `TextScaler` (see `itemGridDelegate`). The same applies to any horizontal chip rail: it needs a bounded cross-axis extent, so state the height via `scaledHeight(context, base)`, not a literal.

**3. Let text wrap and let containers grow.** Chip groups use `Wrap`, not a single `Row`. Anything that can overflow gets `maxLines` + `TextOverflow.ellipsis` deliberately, so truncation is a decision rather than a stripe. Fixed-height containers may only hold non-text content.

**Verification (extends §0).** Every surface must be screenshot-verified at **the 1.3x cap as well as 1.0x**. For the Phone App this is done by temporarily forcing `TextScaler.linear(1.3)` in `MaterialApp.builder`, rebuilding, sweeping the screens, and reverting — the forced override must never be committed. Check specifically for: clipped price/deposit lines in grid tiles, chips cut off at a rail's edge, sticky action bars overlapping content, and labels colliding with their values in two-column rows.

**Screen size is the other half.** Verify at **390px wide** (the common phone), **360px** (the narrow floor — many budget Android devices), and **≥600px** (tablet, where grids widen to 3–4 columns). Onboarding and other centred content caps its measure at `maxWidth: 460` and centres — an earlier version let both title and body run edge-to-edge independently and clipped mid-word on anything wider than a phone.

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

### 2.1 Full rebuild — the phone app is torn down to its theme layer and rebuilt

The prior pass re-themed this surface by swapping palette constants; the structure, spacing, and component vocabulary underneath are unchanged from the original generic build, and it ships **light mode only**. That is not what §1 now describes. **Delete and rebuild the presentation layer** — services, models, providers, and API wiring stay exactly as they are and must not be rewritten.

**Design-system layer to build first (before touching any screen):**
- `core/theme/app_theme.dart` — a real `ThemeData` pair (light + dark) built from `ColorScheme.fromSeed` overrides using the §1.3 hexes, with `textTheme` wired to the §1.2 three-family stack via `google_fonts`.
- `core/theme/theme_controller.dart` — `ChangeNotifier` holding `ThemeMode`, persisted to `shared_preferences`, defaulting to `ThemeMode.system`. Surfaced as a real toggle in Profile.
- `core/theme/tokens.dart` — the 8px spacing scale and the ≤6px radius scale as named constants. Screens reference `AppSpacing.md`, never a bare `16`.
- `core/widgets/` — shared primitives every screen composes from, so spacing/radius can't drift per screen: `AppScaffold`, `AppButton`, `AppTextField`, `AppCard`, `StatusPill`, `MonoText` (the IBM Plex Mono numeral wrapper from §1.2), `AnimatedAuthBackground`.

**Auth screens are a named deliverable, not a checkbox.** Login, Register, and Profile Setup each get: the `mesh_gradient` animated background from §1.5, a real branded lockup, staggered entrance animation on the form fields, inline per-field validation with visible error states, a loading state on the submit button, and correct behaviour in both themes. The current login screen is a white card on a flat background with two unstyled fields — it is the first thing any user sees and it currently looks like a scaffold.

**Every screen must be verified in both light and dark** per §1.6 before it counts as done.

### 2.2 Browse and Home are a *shopping* problem — build them from a shopping template

The marketplace screens were treated as generic lists. They aren't: renting a calculator from another student is a **commerce** interaction, and commerce UI has decades of settled patterns that these screens should inherit rather than reinvent.

**Explicit template references, with real links:**
- **[E-commerce Complete Flutter UI (FlutterShop)](https://github.com/abuanwar072/E-commerce-Complete-Flutter-UI)** — the primary structural reference. Real Flutter code, not a Figma file, covering the exact screen set needed here: home with category rail and product grid, product detail, search, cart, profile. Take its **layout and component structure**, re-themed to §1.3 — do not take its palette or its rounded, shadow-heavy card styling, which conflicts with §1.1/§1.4.
- **[flutter_ecommerce_template](https://github.com/robertodevs/flutter_ecommerce_template)** — minimalist alternative; useful specifically for its restrained product-card treatment, which is closer to "Machined Vault" than FlutterShop's.
- **[E-commerce-App-UI-Flutter](https://github.com/abuanwar072/E-commerce-App-UI-Flutter)** — reference for the category-chip rail and the hero-animated transition from grid tile into detail.

**What the item grid must actually do** (the previous version did almost none of this):
- **A real product card**: image with a fixed aspect ratio, title, price *with its unit* (`₱50/day`, not a bare number), an availability state, the owner's rating, and a deposit hint. Price is mono (§1.2).
- **Two-column grid** on phones, not a full-width list — a list wastes half the screen on items whose photo is the main signal.
- **Skeleton placeholders while loading** (`shimmer`), not a centred spinner. A spinner tells the user nothing about what's coming; a skeleton keeps layout stable and communicates "grid of cards".
- **A category rail** that is horizontally scrollable and shows the active selection, not a wrapped blob of chips.
- **Empty and error states that are real components**, per the same rule §3 applies to charts.

**Quick Actions on Home must stop being a 2×2 grid of equal squares.** Four identical tiles give equal weight to four unequal actions. The primary action (browse/rent) should dominate; the rest are secondary. Use a deliberate asymmetric arrangement, and label each with what it *does*, not a noun.

### 2.3 First-run onboarding and an on-demand tutorial

Two separate things, both required, and they must not be conflated:

**1. First-open walkthrough** — shown once, on first launch only, before/around sign-in. Built with **[`introduction_screen`](https://pub.dev/packages/introduction_screen)** (+ `smooth_page_indicator`). Three or four screens covering what the product actually is: rent gear from other students, the locker holds it, payment is escrowed until handover is verified. It must be skippable, and the "seen" flag persists to `shared_preferences` so it never appears twice.

**2. An always-available "?" tutorial** — a help button in the Home app bar that replays an in-context tour, highlighting real controls one at a time and explaining each. Built with **[`showcaseview`](https://pub.dev/packages/showcaseview)** (v5 API: `ShowcaseView.register(...)` in `initState`, `Showcase(key:, title:, description:, child:)` around each target, `ShowcaseView.get().startShowCase([keys])` to run). This is the piece that makes the app self-explanatory for a first-time renter who skipped onboarding — it points at the actual buttons on screen rather than describing them in the abstract.

The tour runs automatically the first time Home is reached, and on demand from "?" thereafter.

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

**Status: fully scrapped and rebuilt (2026-08-09).** Not re-themed, not adjusted — every screen file, the stylesheet, and the type system were replaced. What follows is the standing spec, with the reasons the previous build failed it recorded inline so the same mistakes aren't reintroduced.

### 4.1 Portrait is the format, not a constraint to work around

The panel is **1080x1920, vertical**. The previous build was laid out as though it were landscape — the main screen put the QR code and its instructions side by side, so the code was small, the copy was squeezed into a narrow column, and roughly two thirds of the screen's height was unused.

- Size from **`vmin`** (the short edge), never `vw`/`vh` directly, so the layout scales as one piece across panel sizes instead of stretching along the long axis.
- Composition reads **top to bottom**: identity, the one primary thing, then secondary options. Two-up grids are fine; two-up *columns of prose* are not.
- Verify at the real 9:16 aspect. A 16:9 browser window will hide exactly the failure this rule exists to catch.

### 4.2 Type and touch

- Type stack is §1.2 — **Space Grotesk / IBM Plex Mono / Manrope**, **self-hosted via `@fontsource`**. The previous build shipped no font files at all and fell through to Inter, which §1.1 bans. Self-hosting is not optional here: this is a Raspberry Pi that may boot with no network, and a kiosk rendering in a fallback face because a CDN was unreachable is a visible failure.
- **Nothing tappable below `--touch-min`** (~9-12mm of physical finger target; ~64-96px on this panel). Kiosk-industry floor, and it is stricter than any of the other three surfaces.
- Radius cap and the no-shadow rule from §1.4 apply. The previous build ran 8/16/24/32px radii — the "large radius" tell.

### 4.3 The block assembly — the kiosk's signature motion

**Every screen change passes through a modular block assembly.** Rectangular panels slide in from the edges and tile the screen completely; the finished wall then clears to reveal the page beneath. Boot runs a longer version that holds a card carrying the wordmark and a **rotating quote about the system**.

**Rectangles, not tetrominoes.** The first version used the seven standard Tetris pieces and read as a video game — the wrong register for a locker terminal in an Engineering building. The shapes are now Mondrian-style: varied rectangles produced by binary subdivision, which reads as architectural drawing and sits correctly with the Blueprint palette. References: [Mondrian generator on CSS Grid](https://codepen.io/vinvanbreugel/pen/pmzmmb), [random Mondrian on CSS Grid](https://codepen.io/nicksands/pen/LYEmbgb), [pure-CSS block preloader](https://codepen.io/wescouch/pen/OYYpWN).

Rules, each of which exists because the first version broke it:

- **The wall must cover the page completely, structurally.** Binary subdivision partitions the rectangle exhaustively, so every cell belongs to exactly one panel. Panel edges are drawn **inside** the panel via inset shadow — never as a grid `gap`, because a gap is a hole and a hole shows the page. An opaque backdrop sits under the panels as a second guarantee. The tetromino version packed greedily, left pockets, and had 2px grid gaps; the page was visible through the transition.
- **Deterministic.** A seeded PRNG (mulberry32) keyed off the screen name, never `Math.random`, so a given screen assembles identically every time while different screens differ.
- **Colour step must be coprime with the palette length** (currently 8 colours, step 3). A step sharing a factor bands the wall into stripes — this happened and had to be fixed.
- **Panels close inward** toward the centre card rather than sweeping in one direction, so the card is the last thing covered and the first thing read.
- `pointer-events: none` on the layer, so a touch during a transition reaches the page underneath instead of being swallowed.
- **Hold long enough to read.** The boot card carries a full sentence; the first version cleared before it could be read. Boot holds ~1.7s after the wall completes.

### 4.4 The kiosk is a promotional surface, not only a terminal

It stands in a corridor and is the only EngiRent touchpoint most passers-by will ever see. **It must carry the same story as `client/web`, in the same words** — if the site's copy changes, the kiosk's is out of date.

Required, all present as of the rebuild:
- **Idle attract loop** cycling: the hero line from the homepage, the six-stage lifecycle, the three "what this replaces" comparisons, and **step-by-step directions for using the machine itself** (this last one was missing entirely and is what the loop most needed).
- **"How it works"** — the full lifecycle, reachable from the menu.
- **"Browse gear"** — real listings, proxied and cached through the kiosk server's `/api/catalogue` (read-only; the kiosk has no login and must never handle credentials on a shared public terminal).
- **"Locker status"** — bay state and what "in use" means. Bay state only; which rental holds which door is not public.

### 4.5 Idle vs active — still two different design problems

**Idle/attract loop** (industry term — use it in code and docs):
- Triggers after inactivity; 30-60s of looping scenes, not one static animation.
- Deliberately the most visually energetic screen on the kiosk. Industry guidance is explicit that this is the one place more energy is correct.
- Must carry the 3D lock animation and an **unmissable animated touch cue** — a static touchscreen does not read as touch-enabled to someone walking past.

**Active flow** — calm and task-focused, the opposite mode:
- QR scan → face verification → locker assignment → item verification → confirmation.
- Back / home / cancel reachable at every step; timeout returns to idle from mid-flow, not just from the menu.
- **Designed offline state.** A kiosk showing a raw API error is a far worse failure than the same error in the phone app.

### 4.6 Template references

- [Kiosk UX/UI design checklist](https://kioskindustry.org/kiosk-ux-ui-how-to-design-checklist/) — the source for the touch-target floor, "one primary task per screen", always-visible back/home/cancel, and session-timeout behaviour.
- ["Self Service Kiosk"](https://www.figma.com/community/file/1475972798185896799/self-service-kiosk) (Figma Community) — general self-service touchscreen patterns.
- ["Home Screen Design for Dodo Pizza's Self-Service Kiosk"](https://www.figma.com/community/file/1446517148275617940/home-screen-design-for-dodo-pizzas-self-service-kiosk) (Figma Community) — structural pattern for categorised offerings with an active-category highlight.
- ["Interactive and Accessible Product Card Design for a Self-Service Kiosk"](https://www.figma.com/community/file/1446514995844693138/interactive-and-accessible-product-card-design-for-a-self-service-kiosk) — the item-card pattern behind the catalogue screen.

---

## 5. Sequencing

This document assumes the same overall structure as the Road Sentinel revamp: audit first (`EngiRent_01_audit_prompt.md` → `documentation.md`), then a master revamp prompt built from that audit, with this document's design phase folded in as a **mandatory full rebuild**, not an optional enhancement — surfaced clearly in the master prompt as such. If the audit reveals the mobile app isn't actually Flutter, or `client/`/`server/` don't map the way assumed here, adjust the implementation details accordingly — the mandate (scrap everything, rebuild per this spec, prove it with screenshots in `DESIGN.md`) does not change.