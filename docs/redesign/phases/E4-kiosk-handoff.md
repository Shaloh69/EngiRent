# E4 — The Two-Screen Handoff

**Goal:** the signature moment, designed as one interface across two displays.
Scheduled before the ordinary screens deliberately — hardest, most valuable,
and it teaches you the most about the rest.

## E4.1 — Choreograph both screens together
Build against `ANIMATION-AND-LOADING-SPEC.md` §2's table. Kiosk screen and
phone screen for each beat designed **in the same sitting**, never separately.
- [ ] Idle / QR display ↔ scan viewfinder
- [ ] Scan detected — **kiosk must react visibly and immediately**
- [ ] Verification needed — kiosk points to phone, names **who** it waits for
      (owner for deposit, renter otherwise — `resolveFaceSubject`'s real rule)
- [ ] Verifying — phone shows progress + **visible 120s countdown** +
      **attempt N of 4**; kiosk shows an alive waiting state
- [ ] Success — kiosk leads, hands attention back to the physical locker
- [ ] Opening — determinate progress from **real per-locker duration** (E0.3's
      measured numbers)
- [ ] Failure — recoverable in place, both screens

## E4.2 — QR freshness
- [ ] 90s TTL visualised, legible across a corridor, informative not urgent

## E4.3 — Face verify screen (phone)
- [ ] Live framing feedback (too dark / hold still) **before** upload
- [ ] In-place retry — failures return in the HTTP response specifically so
      the screen underneath isn't disturbed. Use that
- [ ] Fail-closed message that reads as the system's fault, not the user's face

## E4.4 — Verify against real hardware
- [ ] Real socket events, not mocks
- [ ] **At least two lockers with different calibrated timings** — a sync bug
      only shows up across two different durations
- [ ] Capture both screens at every beat

## E4.5 — The media pipeline, end to end, and fewer human approvals

**Added 2026-09-11 on the user's instruction.** Two asks: *prove the whole
media path for object-reference detection actually works*, and *stop sending
so much to a human — auto-approve above a confidence bar*.

> **SEQUENCING, and it is not negotiable by this phase.** `ENGIRENT-CLAUDE.md`
> §1 puts the item-comparison pipeline **in scope** but makes **`CAPABILITY-GAPS.md`
> A-3 a prerequisite, not a companion**, and says the 85/60 thresholds *stay
> put* unless A-3's measured distribution says otherwise: *"nobody can say
> which of the documented failure modes is real and which is theoretical...
> Measure, then change."*
>
> So **"auto-approve at 90%" is not a number this phase may pick.** 90 is a
> guess until the distribution is measured, and a guessed auto-approve bar
> converts a human review into a wrong outcome silently. A-3 first.

### E4.5a — Prove the media path works end to end (no threshold change)
This is pure verification and can start immediately.
- [ ] Trace ONE real deposit through every hop and show the artifact at each:
      Pi camera → `kiosk:images` → stored file → signed URL → ML fetch →
      `runMlVerification` → verdict → rental transition. **A hop that returns
      200 is not a hop that did something** — D-39 was exactly that
- [ ] Prove the ML service **actually fetched and decoded** the frames, rather
      than scoring a fetch failure as a low score. Fail-closed must be
      distinguishable from fail-quietly in the logs
      — **HALF ANSWERED, and the other half is D-65.** `mlVerificationService`
      *does* distinguish them, returning `unavailable: true` +
      `unavailableReason`, with a unit test for it. **But the flag is read
      nowhere and persisted nowhere**, so in the database a fetch failure is
      byte-identical to a genuine zero-confidence comparison — which is exactly
      why A-3's two rows cannot be interpreted. Needs a schema change; blocks
      E4.5c.
      — **OPEN. The persistence half is BUILT 2026-09-11 and NOT YET LIVE.**
      `Verification` gains `unavailable Boolean @default(false)` +
      `unavailableReason String?` (`prisma/schema.prisma`); all **four**
      `prisma.verification.create` sites in `src/index.ts` spread
      `verificationEvidenceFields(mlResult)`; both ML-unreachable catch blocks
      now build `mlUnreachableResult()` (`unavailableReason: "ml_unreachable"`
      — the third case the service cannot tag itself, because it never ran).
      12 tests in `src/services/__tests__/verificationEvidence.test.ts`,
      **mutation-checked**: dropping the spread from 1 of the 4 write sites
      turns it red (verified, 1 failed / 11 passed). `tsc` clean, 142/142 Jest.
      **DEPLOYED 2026-09-11** to the live database and API (user-authorised):
      `db push` reported in sync, `SHOW COLUMNS` confirms
      `unavailable tinyint(1) NOT NULL DEFAULT 0` + `unavailableReason
      varchar(191) NULL`, `dist/index.js` carries 4 spreads, the API restarted
      (**PID 22976 → 17884**) and serves real JSON, and the two pre-D-65 rows
      are tagged `unknown_pre_d65`. A probe importing the **deployed** helper
      wrote both cases inside a rolled-back transaction:
      `unavailable=1 reason=ml_unreachable` vs `unavailable=0 reason=null`,
      row count unchanged at 2.
      **STILL BLOCKED on hardware, and the continuation prompt was wrong that
      it is not:** Step 8's "drive one verification" has no hardware-free
      route. `POST /kiosk/deposit` opens a real door; the only alternative
      forges a `kiosk:images` socket event, needing the kiosk shared secret and
      a rental in `AWAITING_DEPOSIT` (there are none). So the four call sites
      firing on a real deposit remains unproven. One real deposit closes it.
- [x] ~~Confirm all 5 cameras are enumerated and which locker each maps to —
      `seedKioskConfig` listed 3 where there are 5 (D-54), so the mapping has
      been wrong in writing before~~ — **DONE 2026-09-11, and the bullet itself
      was wrong: there are FOUR, one per locker.** Both numbers in D-54's note
      (3, and 5) are wrong. All four by-path devices resolve, to exactly the
      four capture nodes: L1→video4, L2→video6, L3→video2, L4→video0. The
      scrambled order is why `USB_DEVICE_MAP` uses stable by-path names instead
      of raw indices — see `docs/PROGRESS.md` → E4.5a, including the false
      alarm I raised and corrected.
- [ ] Capture the deposit frames and the listing photos **side by side** for
      one real item, at the resolution the model actually receives

### E4.5b — A-3, the measurement that unlocks everything else
- [ ] Confidence histogram over real verifications, banded at 85 / 60
- [ ] Automated-vs-human fraction as it stands today
- [ ] Admin override rate, and **which direction** overrides go
- [ ] How often the OCR bonus actually changes a verdict
- [ ] Per-locker breakdown — `ITEM-VERIFICATION-PIPELINE-GAPS.md`'s core claim
      is that every kiosk frame shares one locker interior while listing photos
      do not, so background agreement is being scored as object agreement

### E4.5c — Then, and only then, the auto-approval bar
**Frame it as selective prediction, not as a threshold.** The literature calls
this *selective classification with abstention*: the system may decline to
decide and defer to a human, and the abstention rate is the thing you measure.
The principled way to set the bar is **conformal prediction** — calibrate on
A-3's held-out scores to a **target error rate**, which gives distribution-free
finite-sample coverage, rather than eyeballing 90.
- [ ] State the **cost asymmetry explicitly** before choosing anything. A false
      auto-approve accepts the wrong item back and releases a deposit; a false
      deferral costs an admin thirty seconds. These are not symmetric and the
      bar must not be set as if they were
- [ ] Choose a **target error rate**, then derive the threshold from A-3's
      distribution. Record the achieved automation rate that follows from it
- [ ] Keep the abstain path first-class — PENDING is a real outcome here
      (§3), not a failure
- [ ] Re-measure after any pipeline change: a threshold calibrated on old
      evidence is invalid the moment the evidence changes

### E4.5d — Techniques worth evaluating (from a 2026-09-11 literature scan)
Recorded as candidates **to evaluate against A-3's data**, not as decisions:
- **Instance-level, not class-level, matching.** The real question is "is this
  the same calculator", not "is this a calculator". Micro-texture /
  surface-signature approaches (*SketchPrint*, SPIE/EUSIPCO 2015) identify a
  specific physical object from a phone camera and are the closest published
  match to this problem
- **Foreground segmentation against a per-locker background plate**, already
  proposed in `ITEM-VERIFICATION-PIPELINE-GAPS.md`. The patent literature on
  re-identification does the same thing: segment into estimated foreground and
  background before comparing
- **Geometric verification as a gate, not a score.** SIFT/RANSAC inlier count
  under a consistent homography is a much stronger identity signal than a
  global descriptor distance, and it is already partly in the pipeline
- **Agreement across independent signal families** rather than one weighted
  sum — so a single inflated signal cannot carry a verdict
- **Presentation-attack resistance.** A printed photo currently passes. Any
  auto-approval bar makes that strictly worse, because it removes the human
  who might have noticed

*Sources consulted 2026-09-11: SketchPrint (SPIE 2015 / EUSIPCO 2015); USPTO
re-identification and texture-matching patents; conformal abstention and
cost-sensitive selective prediction literature (arXiv 2607.27143, 2502.07255;
Nature Sci. Rep. 2026).*

## Definition of done
- [ ] Every beat implemented on both screens, verified on real hardware
- [ ] Screenshot pairs on disk for every beat, both screens
- [ ] **E4.5a proven** — one real deposit traced hop by hop, with an artifact
      at each hop rather than a 200
- [ ] **A-3 measured and written into `docs/PROGRESS.md`**, before any
      threshold moves
