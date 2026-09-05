# TEMPLATE-LINKS.md — Every Screen Has a Named Template. No Exceptions.

## THE GATE — read this first, it is the rule this whole file exists to enforce

**Every screen, on every surface, MUST have a named template row in this file
before implementation starts. A screen built without one is flagged `FAILED`
and does not ship.** Not "should have." Not "ideally." A screen whose template
column says nothing is a failed screen regardless of how good it looks.

This applies to Flutter screens, admin pages, kiosk screens, and website pages
equally. Four surfaces, one rule.

**Where a genuinely bespoke screen has no meaningful external template** —
and a few here truly don't, because nobody else has built a two-device
phone↔kiosk handoff — the row must still be filled in, with:
1. `BESPOKE` in the template column, **and**
2. a named **pattern reference** (a real, linked thing that solves a
   structurally similar problem, even from a different domain), **and**
3. a one-line justification of why no direct template applies.

A row reading `BESPOKE` with nothing else is `FAILED`. "I couldn't find one"
is not a completed row — finding a structural analogue is the work.

**Verification is by Playwright cross-reference, and it is mandatory:**
for every screen, a template reference screenshot lives at
`design/templates/<surface>-<screen-slug>.png` and an implementation
screenshot at the matching path in `design/screenshots/`. A screen with no
template screenshot on disk is `FAILED` at review time even if this file has
a row for it — the row is the plan, the screenshot pair is the evidence. See
`ENGIRENT-CLAUDE.md` §2 for the capture discipline.

---

## Surface 1 — Flutter mobile app (24 existing screens + 3 added by this track, v1.8.0)

Base UI kit references, applying across all screens unless a row overrides:
- **Best-Flutter-UI-Templates** (mitesh77) — https://github.com/mitesh77/Best-Flutter-UI-Templates
  — the most-referenced free Flutter UI collection; take motion and screen
  composition patterns
- **MarketKy** — free Flutter e-commerce starter, marketplace list/detail/cart
  flows — https://github.com/topics/flutter-template (search MarketKy)
- **flutter_eCommerce_ui_kit** (Furqankhanzada) — https://github.com/Furqankhanzada/flutter_eCommerce_ui_kit
  — sidebar, navigation, slider, cards, form elements
- LogRocket's curated free-template roundup (updated March 2026, filters to
  MIT/Apache/BSD only) — https://blog.logrocket.com/32-free-flutter-templates-mobile-apps/

| Screen | Template | Take |
|---|---|---|
| Onboarding | Best-Flutter-UI-Templates intro/onboarding flows | Page-indicator pacing; content is EngiRent's trust story per `USER-JOURNEY-SIMULATION.md` A1 |
| Login / Register | flutter_eCommerce_ui_kit auth screens | Form layout only — validation copy is bespoke |
| Profile completion | Best-Flutter-UI-Templates multi-step form | Stepper with visible progress |
| **ID photo capture** | `BESPOKE` + pattern ref: any KYC/document-capture flow (e.g. Stripe Identity's document step, https://docs.stripe.com/identity) | No free template covers document capture with edge guides. Why bespoke: the framing guide must match the actual ID card aspect ratio |
| **Face registration** | `BESPOKE` + pattern ref: Stripe Identity selfie step / FaceTec UX guidance | Why bespoke: needs an explanation-before-camera screen (`USER-JOURNEY-SIMULATION.md` A2 — the current design gap), which no generic camera template includes |
| Home dashboard | MarketKy home + Best-Flutter-UI-Templates dashboard | Card hierarchy; active-rental card is the priority element |
| Item browse / search | MarketKy product grid + filter sheet | Grid, filter bottom-sheet, empty state |
| Item detail | flutter_eCommerce_ui_kit product detail | Gallery + sticky action bar; **booked-dates calendar is first-class** (A3) |
| Booked-dates calendar | `table_calendar` package patterns — https://pub.dev/packages/table_calendar | Disabled-date rendering specifically |
| Create listing (owner) | Best-Flutter-UI-Templates multi-step form | Photo upload + condition capture |
| My items | MarketKy list/manage views | Row density, per-item status chips |

| Rental detail | flutter_eCommerce_ui_kit order detail | Timeline of rental state |
| **Kiosk QR scan** | `BESPOKE` + pattern ref: `mobile_scanner` package examples — https://pub.dev/packages/mobile_scanner | Why bespoke: the phone scans a screen, not a printed code, and must mirror kiosk state live (A5). No template does two-device choreography |
| **Face verify (at kiosk)** | `BESPOKE` + pattern ref: Stripe Identity selfie step | Why bespoke: needs live lighting feedback, visible 120s session countdown, and attempt-N-of-4 state (A6) |
| Payments / checkout | flutter_eCommerce_ui_kit checkout | **Design both the mock and live states** (A4) |
| Transaction history | MarketKy order history | Ledger rows with type badges |
| Messages / conversation | Best-Flutter-UI-Templates chat UI | Standard bubble chat |
| Notifications | Best-Flutter-UI-Templates notification list | Read/unread, swipe actions |
| Reviews (write + read) | flutter_eCommerce_ui_kit review components | Star input, review cards |
| Feedback | Best-Flutter-UI-Templates form patterns | Rate-limited (8/15min) — surface that limit gracefully |
| **My Rentals** (`_RentalsTab`) | MarketKy order-history + Best-Flutter-UI-Templates tabbed list | Status-grouped full history, renter- and owner-side both. **Merged with the old duplicate "Rentals list" row — they were the same screen.** `DEFECTS-AND-GAPS.md` D-2 claims this was missing; **it is not** — it is a full bottom-nav tab with filter rail, skeletons, empty/error states, stale banner and socket-driven reload |
| Settings | Best-Flutter-UI-Templates settings | Language picker (**see localization note below**) **+ verification status block** — three states per item, live-updating (D-1). Must never re-prompt for an already-submitted capture |
| **Toast / snackbar layer** (new — D-5) | `BESPOKE` + pattern ref: Material 3 snackbar spec — https://m3.material.io/components/snackbar | Why bespoke: it's an app-wide layer, not a screen. Every mutating call needs visible success/failure |
| **Connection-state indicator** (new — D-4) | `BESPOKE` + pattern ref: any chat app's "reconnecting…" banner (Signal/WhatsApp pattern) | Why bespoke: must reflect the single app-wide socket manager's state, and prompt a refetch on reconnect |
| Payout destination | flutter_eCommerce_ui_kit form patterns | Provider enum + conditional bank/e-wallet fields |
| Edit profile | flutter_eCommerce_ui_kit account/form screens | Labelled field stack + sticky save bar (already on `StickyActionBar`). Distinct from Profile completion: this is *editing*, so it must not re-run capture steps |
| Account activity | Best-Flutter-UI-Templates activity/history list | Reverse-chron merged feed. **Note it's a read-only merge of rentals + notifications**, not a new audit table — the row grouping should make the two sources legible, not hide them |
| Notification preferences | Best-Flutter-UI-Templates settings screen | Grouped toggle rows with section headers. Backs `GET/PUT /notifications/preferences` (`mutedTypes`). **Already built** — `CAPABILITY-GAPS.md` C-2 lists it as missing, which is wrong |
| **Payment webview** | `BESPOKE` + pattern ref: Stripe Checkout's redirect-and-return UX — https://docs.stripe.com/payments/checkout — plus `webview_flutter` examples | Why bespoke: it hosts a third party's checkout page inside a shell, so the only design surface is the chrome — loading, error, and intercepting `/payments/success` and `/payments/cancel` to resolve `PaymentResult`. No template covers "host someone else's page and detect its exit" |
| Send feedback (compose) | Best-Flutter-UI-Templates form patterns | Category picker + body + optional attachment. Separate screen from the Feedback list. **Rate limit is 8/15min — surface it before submit, not as a failure after.** Supports contextual prefill from a failed kiosk scan, payment error, or disputed rental |
| **Force update gate** | `BESPOKE` + pattern ref: Material 3 full-screen dialog — https://m3.material.io/components/dialogs — plus app-store "update required" blocking screens | Why bespoke: a blocking full-screen gate carrying **real content** from `GET /app-config` — `highlights` from the `AppRelease` row and `creditedFixes` naming the users who reported each fixed bug — and pointing at a self-hosted APK, not a store listing. No template models "blocking update screen with a changelog and a credited bug-reporter list" |
| **Auth-guard interstitial** | `BESPOKE` + pattern ref: Material 3 progress-indicator guidance — https://m3.material.io/components/progress-indicators | Why bespoke: it isn't a destination — it's the sub-second frame `_AuthGuard` renders while redirecting an unauthenticated or profile-incomplete user. Two variants. The real design question is whether it should render **anything**: a bare `CircularProgressIndicator` flashing on every guarded route is worse than an empty frame |

---

## Surface 2 — Admin console (18 pages, Next.js 15 / React 19 / **Mantine 7**)

**Do not substitute a Tailwind/shadcn admin template here** — this surface is
Mantine, and mixing component systems is a real cost. Two genuine Mantine
templates exist:

- **mantine-analytics-dashboard** (design-sparx) — https://github.com/design-sparx/mantine-analytics-dashboard
  — free, open source, Mantine + Next.js App Router, Mantine DataTable,
  ApexCharts, Storybook, live theme customizer. **Primary source for this
  surface.** (Current main targets Mantine 8 / Next 16; the repo maintains a
  Mantine 7 / Next 14 branch for backwards compatibility — use the branch
  matching this project's Mantine 7, don't upgrade the app to match a template.)
- **nextjs-mantine-dashboard** (qqharry21) — https://github.com/qqharry21/nextjs-mantine-dashboard
  — secondary reference, same family
- **Mantine DataTable** docs — https://icflorescu.github.io/mantine-datatable/
  — for every table-heavy page below
- **awesome-mantine** — https://github.com/xiaohanyu/awesome-mantine — for
  anything the two templates above don't cover

| Page | Template | Take |
|---|---|---|
| Dashboard | mantine-analytics-dashboard main dashboard | KPI row + chart arrangement |
| Users list / detail | Mantine DataTable + template's user pages | Filterable table, detail drawer |
| Items list / detail | Mantine DataTable | Bulk moderation actions |
| Rentals list / detail | Mantine DataTable + template's detail views | Includes embedded conversation view |
| **Disputes queue** | mantine-analytics-dashboard queue/inbox pattern | **Currently read-only — Journey C's named gap. `POST /admin/rentals/:id/settle` exists with no UI. This page needs a resolve action designed and wired** |
| Payments / transactions | Mantine DataTable + template's invoice module | Refund + payment-decision actions |
| Verifications (AI queue) | mantine-analytics-dashboard queue pattern | **Must show the three ML outcomes distinctly (≥85 / 60–84 / <60) — PENDING is not a failure variant** |
| ID verifications | Same queue pattern | Side-by-side photo comparison |
| Feedback queue | Template's inbox module | Triage states |
| Reports | mantine-analytics-dashboard charts | ApexCharts, already in the template |
| Audit log | Mantine DataTable | Reverse-chron, filterable |
| **Kiosk control** | `BESPOKE` + pattern ref: any industrial SCADA/device-control dashboard layout; closest free analogue is Preline's IoT dashboard category — https://preline.co/templates/ | Why bespoke: this page fires **real relays on real hardware**. No admin template models "this button physically opens a locker in a corridor." Needs confirmation proportional to physical consequence, and live-vs-dead SSE state that is unmistakable |
| Health / self-test | Same as kiosk control | Per-locker status grid |
| Settings | mantine-analytics-dashboard settings page | Kiosk config editor |
| Login | mantine-analytics-dashboard's auth pages (sign-in) | Centred card, field layout, and a real error surface. **The only unauthenticated page on this surface** — it is what a grader sees first if they open the console |
| **Root redirect (`/`)** | `BESPOKE` + pattern ref: Next.js App Router auth-redirect pattern — https://nextjs.org/docs/app/building-your-application/routing/redirecting | Why bespoke: it renders nothing by design — a token-presence check that redirects to `/dashboard` or `/login`. Same design question as the Flutter auth guard: avoid a flash of spinner. **Token presence is not a role check** (E6.2) |

---

## Surface 3 — Kiosk UI (React/Vite on a Raspberry Pi 5 touchscreen)

**This is a public physical touchscreen, not a web app.** Touch-target and
single-task-per-screen rules apply the way they would to any self-service
terminal.

**The panel is 1080×1920 — PORTRAIT** (a 1920×1080 touchscreen mounted
rotated). Both stylesheets are portrait-first and size from `vmin`, the short
edge. `screens.css` also carries an `@media (orientation: landscape)` **safety
net for laptop bench tests** — capturing or designing against that fallback
produces a layout the kiosk never displays, and it looks entirely plausible
while doing so. **Always work at 1080×1920.** Pattern references (portfolio case studies to study, not
copy-paste templates — no open-source kiosk template matches this hardware):

- Self-service checkout kiosk UI studies on Dribbble —
  https://dribbble.com/search/self-checkout-kiosk
- **Take:** minimum 64px touch targets, one decision per screen, huge status
  text readable at standing distance, no hover-dependent affordances.

| Screen | Template | Take |
|---|---|---|
| **Idle / QR display** | `BESPOKE` + pattern ref: airport/transit self-service idle screens | Why bespoke: must display a **regenerating 90s-TTL QR** legibly across a corridor, and read as "scan me with your phone" without instructions |
| **Waiting for phone verification** | `BESPOKE` + pattern ref: payment-terminal "follow instructions on your device" screens | Why bespoke: this screen's whole job is to point at *another screen*. Must name **who** it's waiting for (owner vs. renter, per Journey B) |
| **Locker opening** | `BESPOKE` + pattern ref: elevator/door-status indicators | Why bespoke: **hardware timing varies per locker** — animation must be socket-state-driven, never fixed-duration (A7). **No dedicated component exists**: this is a state within `SuccessScreen`/`VerifyingScreen`, not its own screen. Build it as a state, register it as one. Real spread is 10s on the main door (locker 2 = 5s, lockers 1/3/4 = 15s) and 6s on the actuator — **not the 17s the spec claims**, which compared two different actions |
| Item capture / verification | `BESPOKE` + pattern ref: the same self-checkout studies above | Why bespoke: 4 locker-interior cameras, ML pipeline running, 3 possible outcomes. **No dedicated component exists** — currently a state inside `VerifyingScreen`. Decide deliberately whether it earns its own screen |
| Error / retry | `BESPOKE` + pattern ref: ATM error screens | Why bespoke: a person is standing there holding equipment — errors must be recoverable in place |
| **Main / QR home** | `BESPOKE` + pattern ref: transit ticket-machine and airport self-service home screens | Why bespoke: **this is the primary transaction screen** and the one that actually renders the QR the phone scans — `IdleScreen` is only the attract loop. Must hold a regenerating 90s token legible across a corridor on a portrait panel. **Currently leaves ~35% of the panel empty (D-10), and its caption says the code rotates every 30s when the real TTL is 90s (D-9)** |
| **Catalogue** | `BESPOKE` + pattern ref: the self-checkout kiosk studies above, browse-only variants | Why bespoke: a promotional browse surface with **no cart and no purchase path** — it exists to tell a passer-by what's available, not to transact. Nothing in a retail kiosk template models a catalogue you cannot buy from |
| **How it works** | `BESPOKE` + pattern ref: transit/ATM instructional panels | Why bespoke: read at standing distance by someone who has never used the service, in a single portrait column, with no dependence on scrolling — a corridor reader will not scroll |
| **Locker status** | `BESPOKE` + pattern ref: parcel-locker bay status boards (Amazon Hub / InPost) | Why bespoke: represents 4 **physical** bays whose state is authoritative from hardware. Must use the same locker representation and numbering as the app and admin console (E3.2) |
| **Verifying** | `BESPOKE` + pattern ref: payment-terminal "processing — do not remove card" screens | Why bespoke: must look alive **without implying the kiosk is doing the work** — the phone is. No fake progress bar; the kiosk genuinely does not know how far along the ML call is |
| **Success** | `BESPOKE` + pattern ref: parcel-locker collection-confirmation screens | Why bespoke: the kiosk **leads** at this beat and hands attention back to the physical world — the locker number must dominate the panel (`ANIMATION-AND-LOADING-SPEC.md` §2) |
| **Offline** | `BESPOKE` + pattern ref: ATM "temporarily unavailable" screens | Why bespoke: must be honest **on the idle screen, before someone walks up and wastes a trip** (§5), and must read as "this kiosk cannot reach the server" rather than as an idle state. Currently an overlay above the active screen, not a replacement — keep that |
| *(dead: `QrScreen`, `ConfirmScreen`)* | — | Vestigial from the pre-2026-09-03 reversed flow. **Delete or keep flagged — do not design these.** E0.5's capture is evidence for the ruling: `QrScreen` renders as a near-empty panel reading "Hold your QR code in frame" over a blank camera pane, at a kiosk with no camera |

---

## Surface 4 — Public website (Next.js)

- **Cruip free Tailwind templates** — https://cruip.com/ — landing structure
- **HyperUI** — https://www.hyperui.dev/ — marketing + application components
- **Preline** — https://preline.co/templates/ — full page templates

| Page | Template | Take |
|---|---|---|
| Home / landing | Cruip landing template | Section rhythm. **Content job is trust, not features** (A1) |
| About | HyperUI content blocks | (Note: the "five cameras" claim was already corrected to four — keep hardware facts sourced) |
| Pricing | Cruip / HyperUI pricing sections | Deposit mechanics must be legible — it's the top user anxiety |
| Docs | Preline docs layout | Sidebar + content |
| Blog | Preline blog layout | Real dated engineering journal — don't template it into a marketing blog |
| Mock payment page | `BESPOKE` + pattern ref: Stripe's test-mode banner pattern | Why bespoke: must be unmistakably a test payment (A4) |
| **Download** | Cruip / HyperUI download + CTA sections | **The page every pilot user hits first**, and the target of the in-app update gate's `downloadUrl`. One dominant CTA; version, build number, file size and release date legible without scrolling. Must not drift from `release.ts` — see E7.4 |
| Downloading | `BESPOKE` + pattern ref: app-download interstitials ("your download will begin shortly") | Why bespoke: a timed redirect interstitial that has **two very different audiences** — a curious visitor from the site, and a user whose app is *blocked* by the force-update gate and who has no way back. It must work for the second one |
| Changelog | Preline blog / timeline layout | Dated entry list from `changelog.ts`. **Real engineering journal — don't marketing-ify it**, same rule as the blog. Must agree with `release.ts` and the DB-backed `AppRelease` row (E7.4) |
| Payments — success | HyperUI / Cruip confirmation section + Stripe's post-checkout return pattern | Transaction reference and **what happens next**. Deposit mechanics must be stated here, not just on Pricing — this is the moment the user has actually parted with money |
| Payments — cancel | Same family as success | Non-blaming copy and **one** recovery action back to the rental. A dead end here strands a booking mid-flight |

---

## Localization honesty note (affects the Flutter settings screen row)

32 translated keys across `en`/`fil`/`ceb`, covering auth, bottom nav, and the
home dashboard's rental section. ~20 screens are hardcoded English. A user
selecting Cebuano gets two translated screens and nothing marking the rest as
incomplete. **Either finish the localization or have the language picker say
plainly which parts are translated.** Shipping a picker that silently
half-works is the worse of the three options. This is a design decision that
needs making, not a string-file task to defer.
