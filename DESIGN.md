# EngiRent Hub — Design System & Redesign Status

This tracks the design overhaul mandated by `docs/planning/02-design-mandate.md`: a full scrap-and-remake across all four client surfaces (Phone App, Admin Console, Kiosk, and `client/web`), enforced by a build → screenshot → compare → fix loop, not a description of an intended design.

**Read this section first — it is the most important thing in this file.** The mandate is explicit that "a design doc alone is not enough" and that reporting a surface as done without screenshots to back it up is exactly the failure mode to avoid. In that spirit: **this phase is a verified foundation, not a completed four-surface rebuild.** One surface (Admin Console) has a real, running, screenshot-proven start on the mandated stack. The other three do not yet. Below is an honest accounting, not an optimistic one — treat the "Not started" items as the actual next-session backlog, not as edge cases.

---

## 1. Shared design system (Foundation)

**Status: real, implemented, in use.**

- `client/admin/src/app/theme.ts` — the "EngiRent Spectrum" palette from the mandate (violet/indigo primary, amber secondary, coral tertiary, emerald/amber/red semantic colors), implemented as a full Mantine theme with a 10-shade tuple generated around each mandated hex, plus semantic role aliases (`roleColor.success`, `.critical`, etc.) so page code reads by role rather than raw color name.
- "Campus Day" mode (warm off-white `#FDFBF7`, not stark white) is wired as the base theme for Admin Console and (per the mandate) Phone App. "Vault" (near-black) mode for the Kiosk is specified in the mandate but not yet implemented anywhere — it only matters once the Kiosk's React migration starts (§4 below).
- This token set is currently Admin-Console-specific (`client/admin/src/app/theme.ts`, a Mantine `createTheme()` call) — it has **not yet** been ported to a Flutter `ThemeData` equivalent or a Kiosk Tailwind/CSS-variables equivalent. Doing that port is the actual prerequisite for the Phone App and Kiosk sections below, not a side detail.

## 2. Admin Console — foundation + one flagship screen, screenshot-verified

**Status: partial, real, verified.** HeroUI → Mantine migration started; not finished.

- **Migrated to the mandated stack**: `@mantine/core`, `@mantine/hooks`, `@mantine/notifications`, `@mantine/spotlight` (Cmd+K command palette), `@mantine/dates`, `@mantine/charts`, plus the already-present `framer-motion`.
- **`AdminLayout.tsx`** (used by every admin page) — fully rebuilt on Mantine's `AppShell`, with a working `Spotlight` command palette (Cmd+K, jumps to any nav page) and a Framer Motion page-transition wrapper around the content area. This is the mandate's "Command palette (Cmd+K) — modern admin-panel convention" item, done.
- **`dashboard/page.tsx`** (the Overview/Analytics screen, the mandate's flagship admin requirement) — fully rebuilt: Mantine `Card`/`SimpleGrid` KPI tiles with a staggered Framer Motion entrance, a real `BarChart` (`@mantine/charts`) for "popular categories" fed by **real data** (a new `rentalsByCategory` field added to `GET /admin/stats`, aggregating actual rentals grouped by item category — not a placeholder), and a Mantine `Table` for the recent-rentals feed.
- **Screenshot proof** (Playwright, `chromium`, 1440×900, `docs/design-screenshots/`):
  - `admin-dashboard-mantine.png` — the rebuilt Dashboard, rendering correctly end-to-end (nav, KPI cards, chart with real demo data, table).
  - `admin-users-unmigrated.png` — a still-HeroUI page (Users), confirming the transitional dual-provider setup (`MantineProvider` wrapping `HeroUIProvider` in `providers.tsx`) doesn't break pages not yet migrated. This was a real regression risk worth checking, not a formality — replacing the global provider could have broken every unmigrated page at once.
- **Not migrated yet** (still on HeroUI, functionally fine, visually still the old system): Users, Items, Rentals, Payments, Verifications, Reports, Kiosk, Health Check, Login. Each needs the same Card/Table/Badge → Mantine treatment the Dashboard just got, plus the mandate's page-specific asks not yet addressed anywhere: the AI-verification confidence score + before/after images shown inline on the rental detail drill-down, a dedicated dispute-resolution queue (not buried in the general rentals table), and real-time locker/camera-health status on the Kiosk page (partially covered already by Phase 0.5's Health Check page, but not yet re-styled).

## 3. Kiosk — not started

**Status: not started.** Per the resolved kiosk-framework decision (this session, Phase 3 start — see `memory.md`), the plan is to migrate `server/kiosk/kiosk_ui/` off Flask-served vanilla JS onto a small React/Vite build, so it shares the exact same Framer Motion / React Three Fiber / Lottie stack as the other surfaces instead of a parallel vanilla-JS implementation of the same design. That migration itself — scaffolding the Vite project, wiring it to the existing Flask/Python hardware-control backend, porting the idle "attract loop" and active-use flow — has not been started. Flask stays as the backend/hardware layer regardless; only the frontend moves.

## 4. Phone App (Flutter) — not started

**Status: not started.** The palette exists only as a Mantine theme (§1) — porting it to a Flutter `ThemeData`, adding `lottie_flutter`/`rive` dependencies, and rebuilding the mandated screen list (onboarding, marketplace home, item detail, checkout, active-rentals status tracking with Lottie/Rive state animation, kiosk pickup/return QR flow, owner listing management, notifications, chat, profile, reviews) has not begun.

## 5. `client/web` — not started

**Status: not started.** Scope was resolved this session (Phase 2 → folded into Phase 3, see `memory.md`) but no design work has started. The two leftover scaffold artifacts (`components/counter.tsx`, `package.json`'s `next-app-template` name) are also still present and should be cleaned up as part of this work, not separately.

---

## Why this session stopped here

Phases 0–2 (security/financial fixes, hosting migration, functionality correctness, and real payout/deposit/damage/late-fee money movement) were prioritized and completed first in this same continuous session, per this repo's own `memory.md` — those are genuinely higher-severity, thesis-critical correctness issues (a client-controlled payment amount, unencrypted biometric data, fake payouts) versus a visual redesign. A full four-surface scrap-and-remake with a mandatory per-screen screenshot-verification loop, professional 3D/Lottie/Rive assets, and a from-scratch Kiosk framework migration is realistically a multi-week effort on its own — attempting to rush all of it in the same sitting risked exactly the shallow, unverified outcome the mandate opens by warning against. What's here is real and proven; what isn't here is honestly flagged rather than silently skipped.
