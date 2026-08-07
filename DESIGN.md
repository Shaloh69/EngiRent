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

## Current status summary

| Surface | Status |
|---|---|
| Shared palette | **Done** — EngiRent Vault implemented identically across all four surfaces |
| Admin Console | **Done** — delete-and-rebuild on Mantine, HeroUI removed, 4 missing pages built, verified in both color schemes |
| Kiosk | **Done** — re-themed to Vault, all 9 screens verified |
| Phone App | **Done** — re-themed to Vault, verified against the real deployed API |
| `client/web` | **Done** — rebuilt fresh on Velora UI, Mantine removed, verified desktop + mobile + dark toggle |

## Known gaps, stated honestly

- **No Spline/R3F 3D element and no Lottie/Rive assets.** The mandate asks for these on the Kiosk idle screen and the Phone App's rental-status transitions. No such asset was available to source in this environment, so both use hand-built substitutes instead: the Kiosk's `AnimatedLock` is an SVG + Framer Motion state machine, and the Phone App's status badge is an `AnimatedSwitcher` with a pulsing indicator. These are genuine animations, but they are **not** the mandated tooling and are documented as substitutions rather than passed off as equivalent.
- **The Kiosk page in the Admin Console keeps its own Tailwind layout** rather than being rebuilt on Mantine primitives. Its HeroUI components were converted and it is fully re-themed and verified, but its bespoke layout markup was preserved rather than rewritten — it carries real SSE and hardware-control logic where a full structural rewrite would risk regressions for no visual gain.
- **Kiosk hardware verification remains blocked.** The Pi (`engirent-kiosk`) has been offline in Tailscale throughout this work, so the reboot/autostart test and the hardware self-test are still unverified against real hardware. See `docs/audit/phase4-audit-report.md`.
