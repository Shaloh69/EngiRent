# VISUAL-EVIDENCE.md — Capture, Storage, and Template Conformance

Every screen in this track produces **three permanent images**, all committed,
plus disposable iteration shots. This file defines what gets captured, where
it lives, and — the part that actually matters — **what "matches the template"
concretely means.**

---

## 1. The three permanent images per screen

| Image | Path | When | Committed? |
|---|---|---|---|
| **TEMPLATE** | `design/templates/<surface>-<slug>.png` | Before implementation starts | **Yes** |
| **BEFORE** | `design/before/<surface>-<slug>.png` | **E0, before anything changes** | **Yes** |
| **AFTER** | `design/after/<surface>-<slug>.png` | When the screen reaches PASS | **Yes** |

Plus, not committed:

| | Path | Purpose |
|---|---|---|
| Iteration shots | `design/screenshots/<date>/<slug>-<HHmmss>.png` | The constant "does this look right yet" habit. Disposable |
| Playwright baselines | `design/baselines/` | Machine-managed regression snapshots (`snapshotDir`) |
| Diff/report output | `design/qa-report/` | Regenerated every run |

**The BEFORE capture is time-critical and easy to lose.** It can only be taken
while the old UI still exists. E0.5 captures **every screen on all four
surfaces** before a single line changes — miss it and that screen has no
before-image for the rest of the project. Treat it as a one-shot opportunity,
because it is.

**A BEFORE image is not safe until it is committed.** Sitting untracked in
`design/before/` it survives nothing — not a `git clean`, not a disk failure,
not a machine swap. "Captured" and "committed" are two different states and the
register must not conflate them.

### TEMPLATE images — the genre exception (amended 2026-09-06)

A `BESPOKE` row whose pattern reference names a **genre** rather than a
reachable URL ("ATM error screens", "parcel-locker bay status boards") cannot
have a captured TEMPLATE image, and forcing one would mean committing a real
product's pixels. Such a row satisfies the TEMPLATE requirement with **both**:

- **A shared pattern image we authored** — a structural wireframe at
  `design/templates/pattern-<genre-slug>.png`, **drawn, not captured**. One
  image serves every row referencing that genre.
- **A written structural note** naming the specific composition and affordance
  rules being borrowed — recorded in the register alongside the conformance
  note, and specific enough to be checked against ("single centred message
  block, one dominant recovery action, no navigation chrome"), not a vibe.

Both, or the row is `FAILED`. Nothing else is relaxed: BEFORE, AFTER, the
triptych, the conformance note and the states line are all still required, and
rows that *do* name a reachable URL still need a genuine capture of that
template rendered. Full statement of the amendment: `TEMPLATE-LINKS.md` → THE
GATE → AMENDMENT.

---

## 2. The comparison artifact — a triptych per screen

For each screen at PASS time, generate a single side-by-side image:

```
design/comparisons/<surface>-<slug>.png
   ┌───────────┬───────────┬───────────┐
   │ TEMPLATE  │  BEFORE   │   AFTER   │
   └───────────┴───────────┴───────────┘
```

Committed. This is what a human actually reviews — three separate files in
three folders is technically the same information and practically much harder
to judge. Generate with any image-composition step in the Playwright run
(sharp, ImageMagick, or a small Node script — pick one, keep it consistent).

An index page at `design/comparisons/index.html` listing every triptych, with
its register status, is the review surface for E7.

---

## 3. What "implement what's in the template" concretely means

A screenshot pair proves *a comparison happened*. It doesn't prove the
template was actually followed. **Each screen's PASS requires a filled-in
conformance note** — a short block in the register, not a separate document:

```
Screen: flutter-item-detail
Template: flutter_eCommerce_ui_kit product detail
LAYOUT    ✓ gallery-top / sticky-action-bar-bottom, 2-col spec table
UI        ✓ card elevation + radius from E3 tokens (template's own colours NOT copied)
WIDGETS   ✓ image carousel w/ dot indicator, chip row, sticky CTA, review accordion
          ✗ template's "recently viewed" rail — dropped, no endpoint backs it
SPRITES   ✓ icon set from E3 tokens; no template assets vendored
DEVIATED  price block moved above fold — booked-dates calendar needs the room
```

The four dimensions, each verified deliberately:

**LAYOUT** — structure, grid, hierarchy, what sits where, scroll behaviour,
responsive breakpoints. This is the primary thing being borrowed and the thing
most likely to be silently abandoned mid-build.

**UI DESIGN** — spacing rhythm, elevation, radius, density, type scale.
**Take the template's proportions; never its colours or fonts** — those come
from E3's tokens. A screen that copied a template's palette has failed
conformance in the opposite direction.

**WIDGETS** — the actual components the template uses: carousels, chips,
accordions, sticky bars, steppers, empty states. **List which you took, which
you replaced with an E3 shared component, and which you dropped — with a
reason.** "Dropped: no endpoint backs it" is a good reason; silence is not.

**SPRITES / ASSETS** — icons, illustrations, empty-state art, loading
graphics. Two rules: **prefer E3's token'd icon set over vendoring a
template's assets**, and if anything *is* vendored, its licence goes in
`CREDITS.md` before it's committed, same as any other asset in this project.

**DEVIATED** — every intentional divergence, with its reason. A blank
DEVIATED line on a non-trivial screen is a sign the conformance check wasn't
really done; almost every real screen diverges somewhere.

---

## 4. Rules

- **BEFORE is captured in E0 for every screen, before any change.** One shot,
  no second chance
- **AFTER is captured at PASS, not at "looks done."** If a screen gets a
  second pass later, recapture AFTER and note the pass number — don't
  overwrite silently and lose the history
- **Every capture at both viewports** (1440×900 and 390×844; kiosk at its real
  resolution). A screen with only a desktop capture is `FAILED`
- **Capture set is defined by `STATE-MATRIX.md` §4**, not by intuition:
  populated/empty/error in both themes at both viewports always; loading,
  saving, and offline once per surface; interaction states once on E3's
  reference screen rather than per screen; focus order and contrast asserted
  in tests rather than screenshotted
- **Flutter captures** use `flutter screenshot` or a web-server build — the
  method differs, the requirement doesn't
- **No real user data in any committed image.** The database is currently
  wiped to one admin, but that changes the moment anyone registers. Admin
  console captures especially — use seeded fixtures. A committed screenshot
  with a real name in it is permanent
- **The conformance note is part of PASS.** A screen with all three images and
  no conformance note is `FAILED` — the images prove a comparison was
  possible, the note proves one happened

---

## 5. Why the before-images matter beyond nostalgia

Three practical reasons, not sentiment:

1. **Regression evidence.** "Did we make this worse?" is answerable in
   seconds, and this project has no other safety net — zero admin tests, two
   Flutter tests across 24 screens.
2. **The sign-off report is the actual deliverable to a human** (E7.5), and a
   before/after triptych per screen communicates more than any prose summary
   of what changed.
3. **Redo capability** (`ENGIRENT-CLAUDE.md` §7) depends on it. Redoing a
   screen means rebuilding against the *same* reference — and knowing what the
   previous pass looked like is how you tell whether pass 2 actually improved
   on pass 1 or just changed it.
