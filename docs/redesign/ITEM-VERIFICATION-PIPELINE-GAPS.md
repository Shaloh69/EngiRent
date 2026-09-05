# ITEM-VERIFICATION-PIPELINE-GAPS.md

**What the pipeline is:** when an item is deposited or returned, the kiosk
photographs the locker interior and the ML service compares those frames
against the **owner's original listing photos** to decide whether the right
item is present. `app/comparison/hybrid.py`: quality gate → pHash pre-filter →
traditional CV (colour/shape/texture/HOG/ORB) → SIFT+RANSAC → SSIM → optional
ResNet50 embedding → optional OCR serial match → weighted score → decision at
**≥85 APPROVED / 60–84 PENDING / <60 RETRY** (up to 10 attempts).

**Status changed 2026-09-06: this pipeline is now IN SCOPE** for the redesign
track, on the user's instruction (`ENGIRENT-CLAUDE.md` §1). What feeds the score
and how the score is composed may be changed. **The 85/60/retry-10 thresholds
remain out of scope** — they are not the problem, and moving a threshold to
paper over a weak signal makes the system harder to reason about.

**Prerequisite before any change lands: `CAPABILITY-GAPS.md` A-3** (see §5).
Nobody can currently say which failure mode below is real and which is
theoretical, and this project's history is a warning about changing things that
merely look wrong.

---

## 1. The confounder nobody has accounted for: the locker is the same in every photo

Every kiosk frame shares the **same locker interior** — same walls, same
lighting, same camera, same angle. The owner's listing photos do not: they were
taken on a desk, a bed, a lab bench.

This cuts **both ways at once**, and it is specific to this system rather than
a generic CV caveat:

- **It inflates similarity between different items.** Two different items
  photographed in locker 2 share a large, identical background. Global
  descriptors — colour histograms, pHash, SSIM — score background agreement as
  object agreement. `weight_color` alone is 0.22 of the traditional score.
- **It suppresses similarity for the correct item.** The true match is being
  compared across a domain gap (desk → locker), so the honest signal is
  penalised at the same time the dishonest one is rewarded.

**The single highest-value improvement is therefore not a better matcher — it
is segmentation.** Mask the locker interior (it is a fixed, known background;
a static background plate per locker is trivially obtainable) and compare only
foreground pixels. Everything downstream gets more reliable for free.

## 2. Failure modes, ordered by how likely they are to bite

### 2.1 Same-model substitution — the one visual comparison structurally cannot solve
A renter returns **a different unit of the same model**. Two Casio FX-991ES
calculators are visually identical; no amount of SIFT, SSIM or deep embedding
separates them. The only signal that can is the **serial number**, and serial
OCR is currently a **+10 bonus, never a requirement**.

For any item with a serial, the honest design is: OCR match is a *gate*, not a
bonus. Absent a serial, the system should say it cannot verify identity — only
condition — rather than implying it did.

### 2.2 "Phantom" matches — false accepts with no real correspondence
Documented in the literature and directly applicable here:

- **SIFT locks onto logos and printed text rather than the object.** Two
  different products from the same brand can accumulate enough keypoint matches
  in the logo region alone to pass geometric verification. Dense pixelwise
  approaches do not have this failure ([Combining Deep Learning and
  Verification for Precise Object Instance Detection](https://arxiv.org/pdf/1912.12270)).
- **pHash collisions between perceptually similar but unrelated images**, and
  adversarially craftable collisions ([Adversarial Detection Avoidance
  Attacks](https://arxiv.org/pdf/2106.09820), [Hamming Distributions of Popular
  Perceptual Hashing Techniques](https://arxiv.org/pdf/2212.08035)).
- **Low-texture items** (a plain black bag, a lab gown) give every method
  almost nothing to work with, so scores collapse toward background similarity
  — see §1.

**Mitigation with the best evidence behind it:** keep the layered design, but
require **agreement across independent signal families** rather than a single
weighted sum. A score of 86 built almost entirely from colour + pHash is not
the same evidence as 86 built from SIFT geometry + deep embedding, and the
current formula cannot tell them apart.

### 2.3 The 10-retry loop is a brute-force surface
`max_retry_attempts = 10`, scoring is stochastic across lighting, angle and
placement, and there is **no penalty for repeated near-misses**. Ten attempts
is ten independent samples from a noisy distribution — an adversary simply
re-places the item until one clears 85, and an honest user with a hard-to-match
item is trained to do the same thing.

**Fix shape:** make the *distribution* of attempts part of the decision. Ten
attempts scoring 45, 52, 61, 58… then 86 should be more suspicious than one
attempt at 86, not less. Currently the last attempt is the only one that counts.

### 2.4 No replay or presentation-attack defence
Nothing distinguishes the item from **a printed photograph of the item** held
in the locker. This mirrors the liveness gap already acknowledged for face
verification (`memory.md`, 2026-09-03) and has the same shape. Cheapest useful
signal on fixed hardware: multi-frame parallax or a controlled-illumination
difference frame — a flat print responds to neither the way a real object does.

### 2.5 The OCR bonus can carry a weak comparison over the line
`hybrid.py:251-252` adds a flat, uncapped **+10** on an OCR match. A 76 becomes
86. There *is* a partial guard — the good-pair demotion clamps back to 84 — but
it only fires when fewer than `min_good_pairs` traditional scores clear 60. So
with two mediocre-but-passing pairs, **an OCR match alone promotes a middling
comparison to auto-approved.**

Note this interacts badly with §2.1: OCR is simultaneously **too weak** (a
bonus, when it should gate identity) and **too strong** (able to auto-approve
on its own). Both are the same root problem — it is treated as one more score
rather than as a different *kind* of evidence.

### 2.6 The good-pair check only looks at traditional scores
`good_pair_count` counts `traditional_scores` only. A verdict carried by the
deep embedding or SIFT is judged by a signal that did not carry it.

---

## 3. Techniques worth evaluating

| Technique | What it addresses here |
|---|---|
| **Foreground segmentation against a per-locker background plate** | §1 — the biggest single win, and cheap because the background is fixed and known |
| **Topological / spatial-verification RANSAC** ([paper](https://arxiv.org/pdf/2310.06486)) | §2.2 — instance verification without fine-tuning, stronger than plain geometric RANSAC against logo-only matches |
| **Learned local features** (SuperPoint/LoFTR-class) in place of or alongside SIFT | §2.2 — dense correspondence is markedly more robust to the same-brand-different-product case |
| **Fundamental-matrix RANSAC to reject spurious matches** ([ISPRS](https://isprs-archives.copernicus.org/articles/XLIII-B2-2021/321/2021/isprs-archives-XLIII-B2-2021-321-2021.pdf)) | §2.2 — standard, already partially present via SIFT+RANSAC |
| **OCR as a gate rather than a bonus** ([swap-body detection + OCR](https://arxiv.org/pdf/2004.08118)) | §2.1, §2.5 — the established pattern for "is this the *same unit*" |
| **Agreement-across-families decision rule** | §2.2 — replaces a single weighted sum that can be gamed by one strong family |
| **Attempt-sequence modelling** | §2.3 |
| **Multi-frame parallax / illumination difference** | §2.4 |

## 4. What I would *not* change, even now that the pipeline is in scope

The **85/60 thresholds** (explicitly still out of scope), the **trimmed-mean
aggregation**, the **quality gate**, and **PENDING as a first-class outcome**
are all sound. The problems above are about *what evidence
feeds the score* and *how the score is composed* — not where the lines sit.

Equally: this pipeline is genuinely good for a student project. The layering,
the trimmed mean, the good-pair sanity check and the explicit three-outcome
design are all better than the naive single-metric approach. The gaps here are
the next tier of problem, not basic mistakes.

## 5. Measure before changing anything

None of the above should be actioned on argument alone. **A-3 in
`CAPABILITY-GAPS.md` (ML confidence distribution) is the prerequisite**: the
histogram banded at 85/60, the automated-vs-human fraction, the admin override
rate in the 60–84 band, and **how often the OCR +10 actually changes a
verdict**. If OCR promotion is rare, §2.5 is theoretical; if it is common, it is
the most urgent item in this document. Right now nobody can tell which.

**Sources:**
[Combining Deep Learning and Verification for Precise Object Instance Detection](https://arxiv.org/pdf/1912.12270) ·
[Topological RANSAC for instance verification and retrieval](https://arxiv.org/pdf/2310.06486) ·
[Improving RANSAC Feature Matching Based on Geometric Relation](https://isprs-archives.copernicus.org/articles/XLIII-B2-2021/321/2021/isprs-archives-XLIII-B2-2021-321-2021.pdf) ·
[Adversarial Detection Avoidance Attacks on perceptual hashing](https://arxiv.org/pdf/2106.09820) ·
[Hamming Distributions of Popular Perceptual Hashing Techniques](https://arxiv.org/pdf/2212.08035) ·
[Object Detection and Recognition of Swap-Bodies with OCR](https://arxiv.org/pdf/2004.08118)
