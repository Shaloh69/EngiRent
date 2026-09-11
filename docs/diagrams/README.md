# docs/diagrams — the EngiRent process diagrams

Fourteen sheets covering every process in the system.

**Use the SVG for anything you will zoom into or print.** It is vector, so it
stays sharp at any magnification; the PNGs are raster and will soften. Sheet 13
is also shipped at three raster scales because it is large:

| File | Pixels | Use |
|---|---|---|
| `13-everything.svg` | vector | **zoom, print, thesis figure** |
| `13-everything.png` | 4246x10182 | archival raster, too large for most upload paths |
| `13-everything@1.5x.png` | 3185x7637 | sharp and still shareable |
| `13-everything@1x.png` | 2123x5091 | quick preview |

**Sheet 13 is the one that answers "show me everything":** all of sheets 00–12
in a single flowchart, laid out as stacked bands — stages run down the page,
each stage reads left to right.

| Sheet | File | What it covers |
|---|---|---|
| 00 | `00-system-map` | Four client surfaces, two services, the locker bank |
| 01 | `01-account-and-identity` | Register → profile → ID photo → face → the administrator's decision |
| 02 | `02-listing-an-item` | An owner lists; the photographs become the ML reference set |
| 03 | `03-rental-lifecycle` | Request → money → deposit → collection → return → settlement |
| 04 | `04-rental-state-machine` | The eight `RentalStatus` values and every transition |
| 05 | `05-payments-and-deposit` | Manual GCash, the two transactions, refund and payout |
| 06 | `06-locker-handoff` | The two-screen choreography: wall panel and phone |
| 07 | `07-face-verification` | The QR token, `resolveFaceSubject`, and failing closed |
| 08 | `08-item-verification` | Five signals, the 85 / 60 bands, and the unavailable flag |
| 09 | `09-locker-bay-states` | `LockerStatus`, and why bay 2 is the one that catches bugs |
| 10 | `10-administrator` | The four queues a person actually has to drain |
| 11 | `11-disputes-and-settlement` | What happens when the returned item does not match |
| 12 | `12-notifications` | Four transports, each with a different job |
| **13** | **`13-everything`** | **All of the above in one flowchart** |

## These were read out of the code, not out of the specification

On this project the repository wins over the documents, so every state,
endpoint, threshold and timing on these sheets was derived from source on
2026-09-12:

| Claim on the sheets | Read from |
|---|---|
| The enumerations — rental, locker, transaction, notification | `server/node_server/prisma/schema.prisma` |
| The 93 endpoints | `server/node_server/src/routes/` |
| Every rental transition, with line numbers | `server/node_server/src/index.ts` |
| ≥ 85 APPROVED · 60–84 manual review · < 60 RETRY, up to 10 attempts | `server/python_server/services/ml/app/routers/verification.py:170-174` |
| Whose face the kiosk waits for | `src/services/faceVerificationService.ts:74-110` |
| Per-bay door and actuator timings | `server/kiosk/kiosk_config.json` (read only — never edited) |
| The palette | `design/tokens/tokens.json` |

The plates are drawn on `#050F1A` because that is the ground the physical
kiosk panel renders. `PENDING` is review-cyan rather than warning-yellow,
which is D-42's exact regression.

## Regenerating

```bash
node design/tools/render-diagrams.mjs            # → docs/diagrams/
node design/tools/render-diagrams.mjs <out-dir>  # → somewhere else
```

Diagram sources live in `design/tools/diagrams.mjs` — edit there, never the
generated files. Rendering uses Playwright plus a cached Mermaid bundle at
`design/tools/.cache/mermaid.min.js` (gitignored, ~3 MB). If it is missing:

```bash
node -e "require('https').get('https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js',r=>r.pipe(require('fs').createWriteStream('design/tools/.cache/mermaid.min.js')))"
```

## Two rendering traps worth keeping

**1. Mermaid shrinks the drawing to its container.** It sets `max-width` on the
SVG, so a diagram silently scales down to the width of the *heading text* — the
file looks fine and the drawing is illegible. Six sheets came out at an
identical 978px wide, which was the giveaway. The renderer now pins each SVG to
its own `viewBox` after `mermaid.run()`.

**2. Mermaid's default labels are HTML, not SVG text.** With `htmlLabels: true`
every label is a `<foreignObject>` wrapping an HTML `<div>`. That renders in a
browser and comes out **blank in Word, LaTeX, Inkscape and most viewers** — so
the vector copy, the whole point of which is to be the portable sharp one, was
useless everywhere it mattered. The renderer now sets `htmlLabels: false`, and
also paints the plate ground into the SVG, because mermaid's output is
transparent and light edge-label text vanishes on white paper.

Both are guarded:

```bash
node design/tools/verify-diagram-svg.mjs docs/diagrams/13-everything.svg out.png
```

It loads the `.svg` **directly** — no wrapper page, no injected CSS — and
reports `foreignObjects` (must be 0), the native `<text>` count, the background
fill, and explicit width/height, then screenshots it so the result can be
looked at rather than inferred.
