# docs/diagrams — the EngiRent process diagrams

Fourteen sheets covering every process in the system. **PNG at 2× device scale
for slides and print; SVG alongside each one for anything that will be scaled**
(a thesis figure should use the SVG).

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

**One rendering trap worth keeping.** Mermaid sets `max-width` on the SVG to
its container, so a diagram silently shrinks to the width of the *heading
text* — the numbers still look right while the drawing is illegible. The
renderer pins each SVG to its own `viewBox` size after `mermaid.run()`. If a
future sheet comes out suspiciously small, that is the cause.
