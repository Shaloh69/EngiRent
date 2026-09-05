# design/templates/ — TEMPLATE reference images

Per `docs/redesign/VISUAL-EVIDENCE.md` §1, each screen gets a TEMPLATE image
here, and **a screen with no template image on disk is `FAILED`**.

**A TEMPLATE image must show the actual template screen being borrowed from,
rendered.** Not a documentation page about it, not a search-results grid. An
earlier pass captured website chrome — Material 3 docs landing pages, a Dribbble
search — and filed it here as "templates". That was wrong. Those are now in
`design/research/`, reclassified, and satisfy nothing.

## Two kinds of file live here

**`<surface>-<slug>.png` — captured.** A real render of a real template at a
real URL. This is the normal case and covers every Flutter, admin and website
row.

**`pattern-<genre-slug>.png` — authored (amended 2026-09-06).** A structural
wireframe **we drew**, for `BESPOKE` rows whose pattern reference names a
*genre* rather than a reachable URL — "ATM error screens", "parcel-locker bay
status boards", "payment-terminal processing screens". A genre cannot be
screenshotted, and capturing a real product to fake one would commit
third-party pixels and need a `CREDITS.md` entry without even being a template.

- One image per genre, **shared** by every row referencing it. Seven kiosk rows
  do not need seven images.
- **Must be paired with a written structural note** in the register naming the
  specific composition and affordance rules being borrowed — checkable, not a
  vibe. Image without note, or note without image, is `FAILED`.
- Authored, so nothing is vendored and no licence entry is needed.

Full statement of the amendment: `docs/redesign/TEMPLATE-LINKS.md` → THE GATE
→ AMENDMENT.

Regenerate: `node design/tools/capture-templates.mjs`

---

## Captured — 18 real template screens

### Admin console — 12, from `mantine-analytics-dashboard`'s live demo
`TEMPLATE-LINKS.md` Surface 2's named primary source. The live demo *is* the
template rendered, so these are the genuine article.

| File | Template page | Covers which rows |
|---|---|---|
| `admin-dashboard.png` | `/dashboard/analytics` | Dashboard |
| `admin-reports.png` | `/dashboard/crm` | Reports |
| `admin-users.png` | `/apps/customers` | Users list |
| `admin-users-detail.png` | `/apps/profile` | Users detail |
| `admin-items.png` | `/apps/products` | Items list/detail |
| `admin-rentals.png` | `/apps/orders` | Rentals list, Audit log |
| `admin-rentals-detail.png` | `/apps/invoices/details` | Rentals detail |
| `admin-payments.png` | `/apps/invoices` | Payments/transactions |
| `admin-queue-pattern.png` | `/apps/tasks` | Disputes, Verifications, ID verifications |
| `admin-inbox-pattern.png` | `/apps/email` | Feedback queue |
| `admin-settings.png` | `/apps/settings` | Settings |
| `admin-login.png` | `/auth/signin` | Login |

> **⚠ Version caveat.** The live demo now runs **Mantine 8 / Next 16** — its own
> banner says so. This project is **Mantine 7**, and `TEMPLATE-LINKS.md` is
> explicit: *use the branch matching this project's Mantine 7, don't upgrade the
> app to match a template.* **Take layout, composition and density from these
> captures; do not copy component APIs.** For API-level reference, clone the
> repo's `next-14` branch.

> **Capture quality:** in `admin-dashboard.png` four KPI tiles rendered as empty
> grey placeholders — the demo's stat cards had not hydrated within the 5s
> settle. The layout is legible; the tile content is not. Recapture with a
> longer wait if that content matters.

### Website — 6

| File | Source | Note |
|---|---|---|
| `web-home.png` | Cruip "Simple" demo | Landing structure, section rhythm |
| `web-landing-tidy.png` | Cruip "Tidy" demo | Landing structure. Carries a thin Cruip "Buy Now" frame bar at the top — that strip is Cruip's chrome, not the template |
| `web-templates-index.png` | `preline.co/templates/` | Template index — the URL `TEMPLATE-LINKS.md` actually cites |
| `web-docs.png` | Preline docs | Docs sidebar + content layout |
| `web-components-marketing.png` | HyperUI marketing | Marketing component blocks |
| `web-components-application.png` | HyperUI application | Table/application components |

> **Preline per-page URLs are stale.** `preline.co/templates/agency/*.html`
> (pricing, about, blog) all 404 — three captures came back as the *same* 404
> page and were deleted. Only the templates index resolves. Any future Preline
> reference must be URL-verified before capture.

---

## Still outstanding

**Flutter — 0 of 28 screens.** `Best-Flutter-UI-Templates` and
`flutter_eCommerce_ui_kit` have **no live demo**, and the repos ship almost no
author screenshots (`Best-Flutter-UI-Templates` has exactly one:
`assets/custom_drawer.png`). A real capture means cloning each repo, building it
for web or running it on a device, and screenshotting the specific cited screen.
`ENGIRENT-CLAUDE.md` §5 already permits the `git clone`; the repos are cloned
into scratch. **The build-and-run step has not been done.**

**Kiosk — 0 of 13 screens, and it may be unachievable as specified.** The kiosk's
`BESPOKE` rows reference **genres**, not URLs — "ATM error screens",
"parcel-locker bay boards", "payment-terminal processing screens". You cannot
screenshot a genre, and forcing a PNG would mean capturing a real product's
interface and committing it, which vendors third-party pixels and needs a
`CREDITS.md` licence entry per §3.

### Proposed resolution — still needs a ruling

Amend `VISUAL-EVIDENCE.md` so a `BESPOKE` row whose pattern reference is a genre
satisfies the gate with **a shared pattern reference plus a written structural
note** — what was studied, what structure was taken, what was rejected — instead
of a per-screen PNG. The note is what the conformance check already asks for; a
PNG adds nothing a genre reference can honestly provide.

Until that ruling, those rows stay `FAILED`.

---

## Licensing

Nothing here is vendored into the product — these are reference captures of
public pages kept as design evidence. **If any asset from a template is ever
used in EngiRent's UI, its licence goes in `CREDITS.md` before it is committed**
(`VISUAL-EVIDENCE.md` §3, SPRITES).
