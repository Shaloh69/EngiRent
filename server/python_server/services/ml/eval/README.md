# ML item-verification evaluation

Offline evaluation of the item-verification pipeline against **real** kiosk
captures and listing photos. The images are **not** in git (the repo is
public); `eval/data/` is gitignored. This README and the harness code are.

## Dataset: `data/real_2026-09-24/`

Copied (never moved: the admin review pages and `Verification` rows point at
the originals) from the server PC's
`D:\ENG\EngiRent\server\node_server\storage\` on 2026-09-25:
`verifications/` → `kiosk/`, and `items/` → `listings/`.
**`storage/users/` (face photos) is never copied.**

```
real_2026-09-24/
  manifest.csv                     one row per kiosk frame (see below)
  listings/<item-slug>/listing-N__<dir8>.jpg   the owner's listing photos
  listings/_unmapped/               photos of items no longer listed (spare negatives)
  kiosk/<item-slug>__<rental8>/cap_<YYYY-MM-DD_HHMMSS>/frame-{1,2,3}.jpg
  kiosk/_admin_captures/cap_.../    admin one-off captures of bays 1-4 (unlabelled)
```

Each `cap_*` folder is one capture: 3 frames, 1280×720, from the bay's locker
camera. Times are local (UTC+8).

### `manifest.csv`

| column | meaning |
|---|---|
| `frame` | path under `real_2026-09-24/` |
| `rental` | first 8 chars of the rental id (empty for admin captures) |
| `listing_item`, `listing_folder` | the item this capture claims to be, and its listing photos |
| `bay` | locker number (bay 2's camera is blurry: D-105) |
| `captured_local` | capture time |
| `provisional_label` | `correct`, `wrong_item …`, `empty_bay …`, or `unlabelled`, taken from the 2026-09-24/25 logs |
| `confirmed_by_eye` | `no` until someone opens the frame and confirms the label |
| `source` | the original file on the server |

**Every label is provisional until confirmed by eye.** Known facts from the
logs:

- `phillip-screw-driver__1125ad66`: the owner deposited the **OMEGA rivet tool**
  in place of the screwdriver (quick check 44.29). Hard negative.
- `phillip-screw-driver__cbd2718f`, capture at 00:00:20: **empty bay** (the door
  was never opened, D-104). Negative.
- `little-hammer__3139d8c5`: bay 2, and every frame fails the blur gate (D-105).
  One return frame shows the hammer's **head cut off at the top edge**: a real
  "not centred / truncated" example.

### Negatives beyond the labelled ones

Pairing each kiosk capture with **every other item's** listing photos gives
many more negatives (and `listings/_unmapped/`). Keep the same-category
lookalikes (the rivet tool vs the screwdriver: both black-and-yellow hand tools)
in a separate **hard** set, and report it on its own.

## What the harness must report

For each tier (fast, full): per-sample score, and the **separation**: the worst
correct score vs the best wrong/empty score. The target (user ruling,
2026-09-25): correct ≥ 75 (fast) and 80-95 (full); wrong item or empty bay low
(≤ 40), with a clear gap. Also report the placement verdict (centred /
off-centre / truncated / empty / multiple) and per-stage latency on the server's
CPU (no GPU).
