# design/research/ — reference links, NOT templates

**These are screenshots of websites, not templates.** They were originally
captured into `design/templates/` and that was wrong — a picture of the
Material 3 docs landing page, or a Dribbble search-results grid, is a picture
of *a website's chrome*. It is not a reference image of a screen design, and it
cannot be used to judge whether an implementation followed a template.

They are kept because several are still useful as **research entry points** —
where to go to find the actual pattern — but **none of them satisfies the
`TEMPLATE-LINKS.md` gate**, and no screen may be marked PASS on the strength of
one.

| File | What it actually is | Still useful for |
|---|---|---|
| `kiosk-_pattern-self-checkout-studies.png` | Dribbble search results grid | Entry point to kiosk case studies. **Note: results are almost all landscape/tablet — the EngiRent panel is 1080×1920 portrait** |
| `kiosk-_pattern-portrait-kiosk-totem.png` | Dribbble search results grid | The orientation-correct entry point. Prefer this over the one above |
| `kiosk-_pattern-parcel-locker-ui.png` | Dribbble search results grid | Closest domain analogue — locker bay boards |
| `flutter-_pattern-m3-*.png` | Material 3 documentation pages | The spec pages themselves are authoritative; read them, don't screenshot them |
| `flutter-_pattern-stripe-*.png` | Stripe docs pages | KYC/checkout flow *documentation*, not the UI |
| `flutter-_pattern-mobile-scanner.png`, `-table-calendar.png` | pub.dev package pages | Package docs and example links |
| `admin-_pattern-nextjs-redirecting.png` | Next.js docs page | Routing behaviour reference |

---

## What a real TEMPLATE image requires

A TEMPLATE image must show **the actual template screen being borrowed from**,
rendered. For this project that means, per `ENGIRENT-CLAUDE.md` §5 (which
already anticipates it — *"allow `git clone https://github.com/*` freely, every
template source in `TEMPLATE-LINKS.md` is a public GitHub repo"*):

1. **Clone the template repo** — `Best-Flutter-UI-Templates`,
   `flutter_eCommerce_ui_kit`, `mantine-analytics-dashboard` (its Mantine 7 /
   Next 14 branch, not `main`), MarketKy, Cruip/HyperUI/Preline pages.
2. **Run it.**
3. **Screenshot the specific screen** each row cites — the product detail
   screen, the queue/inbox page, the settings page — at the target viewport.
4. File it as `design/templates/<surface>-<slug>.png`.

That is the real work, and it has not been done. **Every screen's TEMPLATE
image is still outstanding**, and the earlier claim of "11 template references
captured" was wrong — it was 11 website screenshots.

For the kiosk's genre-referenced `BESPOKE` rows (ATM screens, parcel-locker
boards, payment terminals) there is no repo to clone, and capturing a real
product's UI would vendor third-party pixels — see the ruling still needed in
`design/templates/README.md`.
