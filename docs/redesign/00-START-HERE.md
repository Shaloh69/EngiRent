# START HERE — EngiRent Full Audit, Defect Fix, and Redesign

## What this is

A full pass over EngiRent's four surfaces — Flutter app, admin console, kiosk
UI, public website — built on `Implemented.md` (the 2026-09-04 implementation
audit) plus a set of **confirmed, user-reported defects**. Every design
decision traces to a real endpoint, socket event, or piece of hardware
behaviour, not to what a rental app is generally assumed to do.

## Read in this order

| # | File | Why |
|---|---|---|
| 1 | `USER-JOURNEY-SIMULATION.md` | What people physically see, hold, and wait for. Every template choice traces back to a moment here |
| 2 | `DEFECTS-AND-GAPS.md` | **The five reported defects, analyzed against the real API** — plus the four bug *patterns* they generalize into |
| 3 | `TEMPLATE-LINKS.md` | Every screen's named template. **A pass/fail gate, not a suggestion** |
| 4 | `ANIMATION-AND-LOADING-SPEC.md` | The three real waits, the two-screen choreography, why PENDING isn't a failure |
| 5 | `API-TEST-PLAN.md` | Full endpoint + socket coverage, mandatory |
| 6 | `CAPABILITY-GAPS.md` | **What the API already supports that no UI exposes** — user control and admin data, ranked |
| 7 | `ENDGOAL-AND-TRACKING.md` | **What "done" means, the phase map, the status line, the three registers** |
| 8 | `CLAUDE-CODE-PLAYBOOK.md` | Practices, per-phase prompt templates, context management, task handling |
| 9 | `STATE-MATRIX.md` | **Every state of every screen** — data, theme, interaction, role, real-time, content extremes |
| 10 | `VISUAL-EVIDENCE.md` | **Before/after/template capture, and what "matches the template" concretely means** |
| 11 | `REPO-HYGIENE.md` | Folder management; archiving predated docs properly |
| 12 | `ENGIRENT-CLAUDE.md` | Scope, the Playwright gate, redo capability |
| 13 | `FOLDER-STRUCTURE.md` | Where everything lives |
| 14 | `phases/E0`–`E7` | In order, one per session |
| 15 | `KICKOFF_PROMPT.md` | Paste into a fresh Claude Code session |
| 16 | `ITEM-VERIFICATION-PIPELINE-GAPS.md` | Failure modes of the deposit/return item-matching pipeline — the locker-background confounder, same-model substitution, phantom matches, the retry surface. **IN SCOPE as of 2026-09-06** — thresholds are not, and A-3's measurement is a prerequisite |
| 17 | `COMMISSION-AND-PRICING.md` | The ₱400 + ₱20 = ₱420 platform-fee model, admin rate editing, and why the ₱10 transfer fee changes the economics |
| 18 | `PAYMENTS-AND-PAYOUTS-REVAMP.md` | Payment-route fixes, the two payout modes, the owner balance ledger, money-timing notifications, and the admin manual-payout console |
| 19 | `ACCESS-AND-WORKAROUNDS.md` | **How to reach each surface when it isn't there** — and what a dev-mode result does not prove |

## The end goal, in one sentence

**A student can rent equipment from another student, collect it from a
physical locker, and return it — without ever being confused about what the
system is doing, without needing to reload anything, and without an admin
having to intervene in anything the system could have handled itself.**

`ENDGOAL-AND-TRACKING.md` decomposes that into five conditions of done, the
phase map, and the tracking mechanism. Read it early — it's what tells you
whether any proposed piece of work belongs in this track at all.

## Phase order, and why it's this order

| Phase | What |
|---|---|
| **E0** | Discovery — open every surface, verify the audit, reproduce the defects, archive predated docs, stand up the gate. **No changes.** |
| **E1** | Full API + socket test suite |
| **E2** | **Defect fixes + the real-time layer** |
| **E3** | Design foundation (tokens across four stacks) |
| **E4** | The two-screen kiosk handoff |
| **E5** | Flutter app |
| **E6** | Admin console + remaining kiosk screens |
| **E7** | Website + sign-off |

Capability additions from `CAPABILITY-GAPS.md` land inside the surface phases
that own them (user controls in E5, admin data in E6) — they aren't a separate
phase, because they're screens like any other and go through the same template
gate.

**Defects come before cosmetics on purpose.** A beautiful screen that
double-prompts for authentication is still broken. And the API suite comes
before the fixes so the fixes are provable rather than assumed.

## Two rules that make this different from a normal redesign

**1. Every screen must have a named template before implementation.** A screen
without one is flagged `FAILED` and does not ship. Where a screen is genuinely
bespoke — the phone↔kiosk handoff genuinely is — the row still carries
`BESPOKE` **plus** a real pattern reference **plus** a justification. All
three, or `FAILED`.

**2. Verification is by Playwright cross-reference, and it's kept as
permanent evidence.** Every screen gets three committed images — TEMPLATE,
BEFORE (captured in E0, before anything changes), AFTER — plus a side-by-side
triptych, plus a **conformance note** naming what was actually taken from the
template across layout, UI, widgets, and sprites. The row is the plan; the
images prove a comparison was possible; the note proves one happened.

**Why the gate is this strict here:** the admin console has *zero* automated
tests and no test tooling at all; the Flutter app has two unit tests across 24
screens, neither a widget nor an integration test. There is no existing safety
net. Screenshots are currently the only thing that would catch a broken screen.

## What's proven and stays untouched

**Most of the API is proven working in practice, and the hardware path
especially — that's established, don't re-litigate it.** E1 exists to make
that provenness automated and repeatable, not to question it.

Also untouched: the face-verification trust architecture (kiosk validates the
scanned QR against the one token live in its own process — single-use, inside
the 90s TTL, not a signature recomputation; corrected 2026-09-06 in E1 —
identity derived from rental status not client input,
server-side session store, Node calls ML server-side, fails closed when ML is
unreachable), the ML **thresholds** (85/60/retry-10), and the hand-calibrated
per-locker GPIO timings.

**Scope change 2026-09-06 — the item-comparison *pipeline* is now IN scope**
(the thresholds are not). E0 found that the locker's fixed background is an
unaccounted confounder that both inflates similarity between different items
and suppresses it for the correct one, plus five further failure modes. See
`ITEM-VERIFICATION-PIPELINE-GAPS.md`. **A-3's ML reporting is a prerequisite:**
measure which failure modes are real before changing any of them.

**Justified additions this track does make**, each a design gap over a working
backend: the disputes settle UI, admin client-side role gating, an
ID-verification-approved socket event, self-rental server validation, the
real-time subscription layer, the toast layer, and a My Rentals screen.

## Before you start

- [ ] **Security, check first:** is `ML_API_KEY` set where the ML service
      actually runs? It fails **open** when unset — every ML endpoint
      unauthenticated. Does `face_recognition` (dlib) import in the deployed
      service? The fallback silently breaks all face registration
- [ ] Kiosk reachable over Tailscale — E4 needs **two lockers with different
      calibrated timings** to catch sync bugs
- [ ] Kiosk screen's real resolution, for the Playwright viewport
- [ ] Database is wiped to 1 admin / 0 rentals / 0 items — fresh registrations
      needed for any journey walkthrough
