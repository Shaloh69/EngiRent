# EngiRent Hub — Design System & Redesign Status

This tracks the design overhaul mandated by `docs/planning/02-design-mandate.md`: a full scrap-and-remake across all four client surfaces (Phone App, Admin Console, Kiosk, and `client/web`), enforced by a build → screenshot → compare → fix loop, not a description of an intended design.

**Read this section first.** All four surfaces are now on the **"EngiRent Vault"** palette (teal `#0D9488` primary, gold `#F5A623` secondary, coral `#FB7185` tertiary), each rebuilt or re-themed and screenshot-verified against a **real running deployed instance** reached over the public Cloudflare tunnel — not a local dev server. Screenshots live in `docs/design-screenshots/vault-redesign/`.

---

## 0. Why the previous "verified" pass was wrong — and what changed

The prior version of this file reported the Admin Console Dashboard as built and screenshot-verified. Live screenshots of the actually-deployed app then showed: no chart at all, a barely-legible login heading, near-invisible sidebar navigation, and a palette that read as generic light-cards-on-dark. All four were real.

**What the old loop actually checked:** it screenshotted a **local dev server**, in **light mode only**, against a **database that happened to have seeded rental data**. Under those three conditions the dashboard genuinely did render correctly — the screenshot was real, not fabricated.

**Why it missed everything:** each failure only appears outside those conditions.

| Failure | Only visible when | Old loop's blind spot |
|---|---|---|
| Chart missing entirely | database has zero rentals | dev DB always had seed data |
| Page dark, cards light | OS set to dark mode | only ever screenshotted light |
| Login heading unreadable | OS set to dark mode | same |
| Sidebar nav invisible | OS set to dark mode | same |
| Palette not applied | any condition | KPI colors referenced deleted palette names, silently falling back to Mantine defaults — never explicitly asserted |

**Root causes, all real and now fixed:**
- `globals.css` carried a leftover pre-Mantine color system with its own `@media (prefers-color-scheme: dark)` block. On a dark-mode machine it flipped the page background to near-black while `MantineProvider` stayed pinned light — two unsynchronised theming systems on one page.
- `AppShell.Header`/`Navbar` were transparent, inheriting whatever the body painted behind them. That is the direct cause of the invisible nav text.
- The dashboard swapped the entire `BarChart` out for a line of text when data was empty, so a fresh deployment showed no chart.
- The login heading and submit button inherited HeroUI's own OS-dark-mode defaults, rendering light-on-light on a hardcoded light card.

**The hardened loop now used on every surface:**
1. Build, deploy to the **real** instance, and screenshot **that** — the same URL a person would open.
2. Check explicitly, not by impression: **both** light and dark color schemes; **component presence** asserted programmatically (chart/table/card counts); page errors captured.
3. Assert all three brand colors are actually visible, not just the primary.

This caught real bugs during this very pass — a leftover generic-blue login button that survived the palette swap, and a Flutter CORS gap — neither of which a code read would have surfaced.

---

## 1. Shared design system

**Palette — "EngiRent Vault"**, implemented identically on all four surfaces:

| Role | Color | Hex |
|---|---|---|
| Primary / brand | Deep Teal | `#0D9488` |
| Secondary — "key" accent | Gold | `#F5A623` |
| Tertiary — CTA energy | Coral | `#FB7185` |
| Success / available | Emerald (distinct from brand) | `#22C55E` |
| Warning / pending | Amber | `#F59E0B` |
| Critical / dispute | Red | `#EF4444` |

Two modes: **"Campus Day"** (warm off-white `#FDFBF7`) for Phone App, Admin Console, and `client/web`; **"Vault"** (near-black, teal-tinted neutrals) for the Kiosk.

Implemented in: `client/admin/src/app/theme.ts` (Mantine), `client/admin/src/app/globals.css` (CSS vars), `server/kiosk/kiosk_ui_react/src/theme.css`, `client/flutter_app/lib/core/constants/app_colors.dart`, `client/web/styles/globals.css`.

## 2. Admin Console — delete-and-rebuild, complete

**Status: done.** Every page rebuilt on Mantine; **HeroUI fully removed** (packages uninstalled, provider deleted, Tailwind plugin and `hero.js` gone, last HeroUI component deleted). 16 routes build cleanly, up from 12.

- **Shared primitives** (`components/ui/`): `PageHeader`, `DataTableCard`, `StatusBadge`, `EmptyState` — so status colors and empty states are consistent rather than re-invented per page, and every table keeps its header row when empty instead of collapsing.
- **Four pages the mandate requires that did not exist at all**:
  - **`/disputes`** — a dedicated, prioritised resolution queue merging disputed rentals and failed/low-confidence AI verifications, ordered by severity then age. Its own top-level nav entry, explicitly *not* a filter on `/rentals`, which the mandate calls out directly.
  - **`/settings`** — kiosk verification/timing config (genuinely editable, backed by the existing `PUT /admin/kiosks/:id/config`) alongside the late-fee rate table. The fee rates are compile-time server constants with no config endpoint, so they're shown as a clearly-labelled **read-only reference** rather than a form whose save button would silently do nothing.
  - **`/users/[id]`** — profile, lifetime stats, full rental history.
  - **`/rentals/[id]`** — the mandate's most specific ask: the full requested → paid → deposited → claimed → verified → completed timeline, with AI verification confidence scores and before/after capture images inline.
- **Dashboard chart** now always renders its shell, with an overlay explaining an empty state — a missing component is a fail condition, an empty state is not.
- **Screenshot proof**: all 11 pages × both color schemes, after a real login, with programmatic component-presence assertions. Component counts are identical in light and dark — the divergence that broke the last pass is gone.

## 3. Kiosk — re-themed, complete

**Status: done.** The React/Vite migration was already complete; this pass re-themed it off violet.

- `theme.css` now teal-primary with teal-tinted dark neutrals, so surfaces sit under the new primary rather than quietly keeping the old one. Emerald moved to the distinct success shade so "available" no longer reads as brand-colored.
- `--violet`/`--amber` are **kept as aliases** of `--teal`/`--gold` rather than renamed: ~20 call sites across `screens.css` and the screen components reference them, and rewriting each changes no rendered pixel while risking a missed one. New code uses `--teal`/`--gold`.
- The two hardcoded violet hexes outside the variable system (`AnimatedLock`'s SVG stroke/fill, one gradient stop) were replaced.
- **Screenshot proof**: all 9 screens (8 states + offline fallback) at the real 1024×600 kiosk viewport via demo mode.

## 4. Phone App — re-themed, complete

**Status: done.**

- Teal primary throughout, plus the tinted neutrals (text, borders, gradients) that were carrying the old violet cast.
- **A real semantic bug fixed**: `secondary` held the *exact same hex* as `success` (`#10B981`) and was used across ~12 call sites for availability semantics — leaving the mandate's actual secondary role (the gold "key" accent) with no representation at all. Those call sites now use explicit `success`/`successDark`/`successLight` constants, freeing `secondary` to be gold. This keeps "Available" badges green (turning them gold would read as a warning) while giving the palette its third brand color.
- **Screenshot proof**: logged in as a seeded user against the **real deployed API over the public tunnel** — login, biometric-consent, home, and rentals screens.
- **A real CORS gap was caught** doing this: the Flutter web origin wasn't in the API's allow-list. Browser-testing only — a packaged APK sends no `Origin` header.

## 5. `client/web` — rebuilt fresh on Velora UI, complete

**Status: done.** Rebuilt on Velora UI's shadcn/Tailwind stack; **Mantine fully removed** from this package (a deliberate exception to "Mantine everywhere" — mandate §3.5 — since this surface shares no components or session with the app surfaces).

- **Velora's `aurora-background` is the real component**, installed from its actual shadcn registry (`velora.colorlib.com/r/aurora-background.json`) unmodified, including its three drift keyframes. Only the `--brand-*` variables it reads are re-themed. Its blobs deliberately use teal **and** gold **and** coral so the hero carries the whole palette — and it reuses the same animated-background technique as the Kiosk's idle screen, giving the two surfaces one visual language.
- Pages: home (aurora hero, 6-step real workflow, CTA), about (architecture + design principles), pricing, docs, blog.
- **Two content-honesty corrections**:
  - **Pricing** was a generic 3-tier SaaS table, which misrepresents the real model — EngiRent takes **no commission** (rental fees are a full pass-through; there is no fee field in the schema). It now explains where money actually goes, with the real per-category late-fee rates.
  - **Blog** shipped three invented posts with fabricated publication dates for articles that were never written. The mandate explicitly forbids padding a blog with placeholder posts, so it's now a project journal of real engineering milestones — with no invented dates.
  - **Docs** content was carried forward as instructed, with one factual fix: it said "GCash payment" when the confirmed integration is **PayMongo** (GCash is a method PayMongo exposes, not the integration).
- `prefers-reduced-motion` holds the aurora still for anyone who asks for less motion.
- **Screenshot proof**: all 5 pages at desktop and mobile widths, plus the dark-mode toggle confirmed to genuinely flip the theme and stay legible.

---

---

## 6. Animated backgrounds, anti-slop rules, and light/dark — the second design pass

Feedback after the Vault pass was that the result still read as bland. Research into what specifically makes generated UI *look* generated produced a concrete list — and several of those tells were in this codebase. The mandate gained four new sections (§1.0–§1.6) as a result, and this pass implements them.

**What the mandate now bans, and what was actually here:**

| Tell | Was it present? |
|---|---|
| **Inter** as the primary typeface | Yes — Admin Console's Mantine theme, and the Flutter app's `fontFamily: 'Inter'` (which wasn't even a declared asset, so it silently fell back to the platform default) |
| Border-radius above 6px, pill buttons | Yes — Mantine's default `md` radius is 8px, already over the cap |
| Multi-layer elevation shadows | Yes — a `0 10px 30px` soft shadow token |
| Generic gray neutrals | Yes — Mantine's stock `dark` tuple is neutral slate, so dark mode read as a library default on a teal-tinted page |
| Icon-grid feature section | Yes — `client/web`'s homepage (still present, see gaps) |

**Named aesthetic direction, committed to once: "Machined Vault"** — engineering instrument rather than SaaS dashboard. The reference objects are the things these students actually handle: a caliper, an oscilloscope faceplate, a machined enclosure, a brass padlock.

**Type stack (§1.2), now identical on all four surfaces:** Space Grotesk (display) · IBM Plex Mono (all numerals, IDs, currency, countdowns — with tabular figures) · Manrope (body).

**Animated backgrounds (§1.5), one named component per surface:**
- **Admin Console, Kiosk** — Aurora, vendored from react-bits' registry as real source files rather than an opaque dependency, rendering through `ogl` (~30KB) instead of a 600KB three.js.
- **`client/web`** — Velora UI's CSS aurora, already present and animating.
- **Phone App** — `mesh_gradient` fragment shader, since react-bits is React-only.

Every one carries two guarantees: `prefers-reduced-motion` freezes it to a static frame, and renderer failure degrades to a CSS/static gradient rather than an empty rectangle. That fallback matters most on the Kiosk, whose Pi hardware this repo still cannot reach to test.

**Light and dark (§1.6) on three of four surfaces.** The Kiosk stays permanently dark by design — fixed public display, one lighting environment, no per-user preference to persist.

**Two real bugs this pass found and fixed:**
- **`client/web` never followed the OS.** `defaultTheme` was pinned to `"light"` with `enableSystem` off, so a visitor on a dark-mode machine always got the light site; the toggle was the only route to dark.
- **`client/web`'s mono font was a phantom.** `globals.css` declared `"JetBrains Mono"` while `config/fonts.ts` loaded a different family — the CSS reference and the loaded font had drifted apart.

**And two caught by the screenshot loop mid-pass, before they shipped:**
- The Admin login's aurora washed body copy to roughly 1.5:1 in light mode. Fixed with a scheme-aware scrim between the animation and the text.
- Lifting the Kiosk idle content above the new canvas with `position: relative` dropped it out of the fixed `.screen` box and piled everything at the right edge — the exact trap a comment already in that file warned about. Fixed by setting `z-index` only.

## Current status summary

| Surface | Status |
|---|---|
| Shared palette | **Done** — EngiRent Vault implemented identically across all four surfaces |
| Shared type stack | **Done** — Space Grotesk / IBM Plex Mono / Manrope on all four; Inter fully removed |
| Admin Console | **Done** — delete-and-rebuild on Mantine, HeroUI removed, 4 missing pages built, plus Aurora background, real dark mode with persisted toggle, teal-tinted dark surfaces, mono KPI figures. Verified in both schemes |
| Kiosk | **Done** — re-themed to Vault, all 9 screens verified, Aurora on the idle attract loop. Dark-only by design |
| `client/web` | **Done** — rebuilt fresh on Velora UI, animated aurora, follow-OS dark mode fixed, type stack aligned. Verified in both schemes |
| Phone App | **Partial** — see below |

**Phone App, precisely:** the design-system layer is complete — light/dark ThemeData pair, persisted ThemeController defaulting to system, 8px/6px token scales, the animated mesh background, the full type stack, and shared primitives (AppPalette, AppCard, StatusPill, MonoText, SectionLabel, InfoRow, AppEmptyState, Stagger) that screens compose from so spacing and radius cannot drift. **Every screen is theme-aware** — 124 light-only palette references across 12 files were painting light surfaces and near-invisible grey text in dark mode, and all now resolve through AppPalette.of(context).

**Rebuilt against the shopping-template spec (§2.2), verified against the real deployed API in both themes:** Login, Register, Home, Browse, Item Detail — plus a new Onboarding flow. Home dropped the 2x2 grid of equal squares for an asymmetric layout (browse is primary and full-width; the rest share a compact row) and now shows real inventory rather than only navigation. Browse and Item Detail are genuine commerce screens: product cards with photo, price *with unit*, deposit and availability; skeleton loading; a category rail; a full cost table and a sticky price/CTA bar on detail.

**Onboarding and the in-app tutorial (§2.3)** are both built and working: a one-time `introduction_screen` walkthrough resolved before first paint, and a `showcaseview` "?" tour in the Home app bar that highlights the real controls one at a time — auto-running on first arrival, on demand thereafter.

**All remaining screens rebuilt (v1.5.1).** Profile Setup, Create Rental, Kiosk Scan, Create Item, Reviews, Payout Details, the Alerts tab and the Profile tab were each reworked against §2.2, on a new shared form kit (`core/widgets/form_widgets.dart`: `FormSection`, `AppField`, `AppPickerField`, `NoticeBanner`, `StickyActionBar`, `CostRow`, `StepHeader`). The recurring pattern replaced was a flat column of bare `TextFormField`s with the submit button scrolled off the bottom; forms are now grouped into titled sections with the primary action pinned.

Two real defects were found and fixed while rebuilding, neither of them cosmetic:

- **The Profile tab claimed "Identity Verified" unconditionally**, ignoring the `isVerified` flag that the API already returns. Users awaiting admin review were told the opposite of the truth. Both the header pill and the Identity row now read the real value.
- **Create Rental's date picker hardcoded `ColorScheme.light`**, so in dark mode it rendered white-on-white. It now inherits the app theme.

The Profile tab's gradient hero (banned by §1.1) is gone, replaced by a bordered identity card.

**§1.7 text scaling — the user-reported v1.4.0 bug.** "On other phones the texts are too big and scrollable" was a layout failure, not a font choice: the product grids used `childAspectRatio: 0.63`, a constant tuned by eye, so when a title wrapped to a second line at a larger system font size the price and deposit lines were cut off. Fixed at three levels — a 0.9–1.3 `textScaler` clamp in `MaterialApp.builder`, a new `itemGridDelegate` that computes `mainAxisExtent` from the measured text at the active scale instead of a fixed ratio, and `scaledHeight()` for the chip rails and photo strip that need a stated height.

**Verified at the extremes, not just the default.** Screenshot sweeps were run at 390px/1.0x in both themes, at 390px with `TextScaler.linear(1.3)` forced (the clamp ceiling), and at **360px combined with 1.3x** — the narrowest common Android screen at the largest scale the app will render. Grid tiles grow to fit, every deposit line stays intact, and the checkout's quick-pick chips wrap to a second row rather than overflowing. The forced-scale override was reverted before building the APK.

**One verification-harness bug worth recording.** The first sweep of this pass screenshotted a *stale build* and would have "confirmed" work that wasn't running: a leftover `dart` web server from an earlier session still held `[::1]:8092` while the fresh server bound `127.0.0.1:8092`, and Chromium resolves `localhost` to `::1` first. The screenshots looked plausible — right app, right theme — which is exactly why it was nearly missed. Checking `netstat` for duplicate listeners is now part of the loop.

**A real functional bug fixed alongside the design work:** user photos are served from an authenticated route (`GET /media/users/:id/face.jpg`, behind the `authenticate` middleware), but every avatar used a bare `NetworkImage`, which sends no credentials. Verified directly against the deployed API — 401 with no header, 404 with a valid Bearer token — so profile pictures could never have loaded for anyone. A new `AppAvatar` attaches the token, caches, and falls back to initials on both a missing URL and a failed fetch. Listing photos were unaffected (external URLs).

## Known gaps, stated honestly

- **No Spline/R3F 3D element and no Lottie/Rive assets.** The mandate asks for these on the Kiosk idle screen and the Phone App's rental-status transitions. No such asset was available to source in this environment, so both use hand-built substitutes instead: the Kiosk's `AnimatedLock` is an SVG + Framer Motion state machine, and the Phone App's status badge is an `AnimatedSwitcher` with a pulsing indicator. These are genuine animations, but they are **not** the mandated tooling and are documented as substitutions rather than passed off as equivalent.
- **The Kiosk page in the Admin Console keeps its own Tailwind layout** rather than being rebuilt on Mantine primitives. Its HeroUI components were converted and it is fully re-themed and verified, but its bespoke layout markup was preserved rather than rewritten — it carries real SSE and hardware-control logic where a full structural rewrite would risk regressions for no visual gain.
- **Kiosk hardware verification remains blocked.** The Pi (`engirent-kiosk`) has been offline in Tailscale throughout this work, so the reboot/autostart test and the hardware self-test are still unverified against real hardware. See `docs/predated/audit/phase4-audit-report.md`.

### Gaps introduced or left open by the animated-background pass (§6)

- **Phone App: 12 of 13 screens are theme-inherited, not rebuilt.** Stated in full in the status table above. Login is the only screen rebuilt against §2.1's spec.
- ~~client/web homepage icon-grid~~ — **fixed.** Replaced with a comparison table (an allowed §1.1 alternative), and radius swept under the 6px cap site-wide. Original note follows: **`client/web`'s homepage still used the banned icon-grid feature pattern** — three identical icon + title + blurb cards, which §1.1 now explicitly lists as a tell. The palette, fonts, dark mode, and animated background on that page are fixed; the section's *structure* is not, and redesigning it is outstanding.
- **Deployed and fully re-verified against the real instance.** The pass was deployed to `desktop-gklhcri` (source files copied directly; the remote's git working tree was left alone, since it carries uncommitted changes from the previous deploy) and all three web surfaces rebuilt there. `docs/design-screenshots/animated-pass/deployed/` holds real screenshots of the **public Cloudflare tunnel URLs** — Admin login, Admin dashboard, `client/web` home, and the new `/download` page — each in both colour schemes. This satisfies §0 for the Admin Console and `client/web`.
- **The empty-data chart case is now confirmed fixed on the real deployment.** This was the original reported failure: the dashboard's "Popular Categories" chart was omitted entirely when there was no rental data, leaving bare text. The deployed database currently holds 3 users, 4 items and **zero rentals** — the exact condition that triggered it — and the chart now renders its full shell (axes, gridlines, category labels) with an explicit "No rentals yet" empty state inside it. §3 of the mandate requires precisely this: *"A chart must actually render — an empty-data state should still show the chart shell, not omit the component entirely."*
- **The Kiosk's Aurora is unverified on Pi hardware.** Verified in desktop Chromium at the kiosk's 1024×600 viewport only. Whether the Pi's WebGL context supports it — or falls back to the CSS gradient — is untested, because the Pi is offline.
