# ANIMATION-AND-LOADING-SPEC.md
### Every animation here exists because a real system behaviour needs it. Timings come from `Implemented.md`'s actual hardware and pipeline numbers, not from taste.

## 0. The rule

An animation earns its place if it does one of three things: **tells the user
what the system is doing**, **keeps two screens in agreement**, or **makes a
real wait tolerable.** Anything that does none of those is decoration, and on
a public kiosk running 24/7 it also costs power and attention. Decoration
gets cut.

Everything respects `prefers-reduced-motion` (web/admin) and the OS
reduce-motion setting (Flutter: `MediaQuery.disableAnimations`) — **freeze to
the end state, don't slow down.**

---

## 1. The three real waits — each needs a different treatment

The system has three genuinely long operations. None of them is currently
designed as a wait. Each has a different *shape*, so each gets a different
loading pattern — a single generic spinner across all three would be the
wrong answer three times.

### 1.1 Locker actuation — 5 to 22 seconds, hardware-driven, **known duration**
Real per-locker calibration from `kiosk_config.json`: locker 1 runs
15/15/22/22s extend/retract/open/close; locker 2 runs 5/5/21/21s. That's up
to a **17-second difference between lockers for the same action.**

- **Never use a fixed-duration animation.** Drive it from socket state
  (`kiosk:command` variants, `kiosk:status`). A canned 3-second "opening"
  animation on a locker that takes 22 seconds is a lie the user will catch.
- Because the configured duration for *that specific locker* is known, this
  can be a **real determinate progress indicator** — not a guess. Use it.
- At 22 seconds, add a reassurance beat around 8–10s ("still opening — this
  locker takes about 20 seconds") so it doesn't read as a hang.
- Mirror on **both** phone and kiosk simultaneously (§2).

### 1.2 ML item verification — multi-stage, **known stages, unknown duration**
The real pipeline: quality gate → pHash pre-filter → traditional CV → SIFT +
RANSAC → SSIM → ResNet50 → OCR.

- These are **named, ordered, genuinely distinct stages** — show them. A
  stepped indicator that advances through real stage names beats a spinner,
  and it's honest, because the stages exist.
- Don't fake per-stage timing. Advance on real signal, or show the current
  stage without a fake progress bar underneath it.
- **Three outcomes need three visual languages** (§3).

### 1.3 Face verification round-trip — short, but **high-anxiety**
Phone captures → `POST /kiosk/verify-face` → Node → ML service → response.

- Short enough for a simple indeterminate indicator, but it needs the
  **120-second session countdown** visible alongside it (§2.3) and
  **attempt N of 4** state.
- On failure, the retry is *local* — the architecture deliberately returns
  failures in the HTTP response rather than via socket, specifically so the
  screen underneath isn't disturbed. **Design the retry as a smooth in-place
  transition, not a screen reload.** The backend already paid for this;
  don't waste it.

---

## 2. The two-screen choreography (the signature moment)

During the kiosk handoff, the user sees their phone and the kiosk at the same
time. **These two screens must never disagree.** Treat them as one interface
rendered across two displays.

| Moment | Kiosk shows | Phone shows | Transition |
|---|---|---|---|
| Idle | QR code, regenerating (90s TTL) | Scan viewfinder | — |
| Scan detected | Immediate acknowledgement — the QR gives way to a confirmation state | "Connected to KIOSK-001" | **Both animate within the same beat.** The kiosk must react visibly the instant `kiosk:session_validate` succeeds — a person who scanned and sees nothing change on the kiosk assumes it failed |
| Verification needed | "Check your phone" + **who** it's waiting for (owner vs renter) | Camera opens with framing guide | Kiosk transition should *point* — motion directed downward/toward the user, not a neutral fade |
| Verifying | Passive waiting state, clearly alive (not frozen) | Progress + countdown + attempt N of 4 | — |
| Success | Locker number, large | Success + "go to locker N" | **Kiosk leads here** — the phone should hand attention back to the physical world |
| Opening | Determinate progress, real duration (§1.1) | Mirrored, same progress | Both driven by the same socket events |
| Failure | Recoverable message, retry affordance | Local retry, screen intact | Never dump either screen back to idle without explanation |

**QR TTL visualisation:** the 90-second token is regenerating continuously. A
subtle ring/bar showing freshness prevents "is this code stale?" doubt without
creating urgency.

**Session countdown (120s):** visible, calm, non-red until genuinely low.
This is the constraint most likely to expire on someone mid-attempt, and
currently it is completely invisible to them.

---

## 3. PENDING is a first-class state, not a failure

Both the ML item pipeline (60–84 = manual review) and the disputes queue
produce a "a human will look at this" outcome. It currently has no distinct
design language and will be read as failure by default.

Three outcomes, three treatments:
- **APPROVED (≥85)** — resolved, positive, brief. Don't over-celebrate; this
  is the expected path.
- **PENDING (60–84)** — **neutral, informative, not red, not a warning
  triangle.** Explain what happens next and roughly when. This is the state
  most in need of good copy in the whole product.
- **RETRY (<60)** — actionable. Show attempt count (up to 10) and what would
  improve the next try (lighting, angle, framing). Ten attempts is a lot of
  someone's time; each one should teach.

---

## 4. Transitions, per surface

**Flutter:** standard platform page transitions. One exception — the kiosk
handoff flow (scan → verify → success) should feel like **one continuous
sequence**, not separate pages, since it's one continuous real-world moment.

**Admin console:** fast and unobtrusive. Table pages get skeleton rows
matching real column layout, not spinners. **The kiosk-control page's live
SSE state must visually distinguish live / stale / disconnected** — a dead
stream that looks idle is a real operational hazard when the operator is
controlling physical hardware.

**Kiosk:** more expressive than the others, because it's a fixed device with
a controlled screen and it needs to catch attention from across a corridor —
but **only while idle.** During an active transaction, motion drops to
functional only. Nobody standing there with equipment wants a flourish.

**Website:** restrained. Scroll-triggered reveals at most.

---

## 5. Idle / attract behaviour (kiosk only)

The kiosk sits unused most of the day. Its idle screen should:
- Keep the QR prominent and obviously scannable
- Cycle brief "how this works" guidance (scan → verify on your phone → collect)
- Show its own health honestly — if it can't reach Node, say so **on the idle
  screen**, before someone walks up and wastes their time
- Stay low-motion enough not to burn in or distract a corridor

---

## 6. What not to build

- Confetti or celebration animation on payment or return
- Fixed-duration fake progress bars anywhere (§1.1 explains why)
- Skeleton screens on the kiosk — it has known, controlled data; use real states
- Any animation that blocks input
- Motion on the admin console that delays an operator controlling hardware
