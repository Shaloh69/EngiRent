# CONTINUE-E3-SESSION-1.md — paste into a fresh Claude Code session

> Supersedes CONTINUE-E2-SESSION-4.md. Written 2026-09-08 at the E2→E3
> boundary. **E0, E1, E2 are all COMPLETE.** E3 has not started.

---

**You are resuming the EngiRent redesign track at the start of E3 (design
foundation). E0, E1, and E2 are complete.**

**First: `git branch --show-current` must say `e0-e1-audit-tests-and-evidence`.**
All work lives there (36 commits as of this writing). **`main` has none of
it, and you must not push** — the repo is public and pushing would republish
S-3/S-4/S-5 history and a real student's photos from `design/before/`. If you
are on `main`, stop and tell me.

Read, in this order, and **only** these:

1. `CLAUDE.md`
2. `docs/redesign/ENGIRENT-CLAUDE.md`
3. `docs/PROGRESS.md` — in full. Start with its CONTEXT DEGRADATION LOG.
   The **E3 section-by-section table** (the G2 gate) is already written there.
4. `docs/redesign/CLAUDE-CODE-PLAYBOOK.md` §2c-2d — the incident log and the
   seven gates.
5. `docs/redesign/phases/E3-design-foundation.md`

Open every response with the status line from PROGRESS.md.

---

## What E2 leaves you (all verified on screen, debt 0)

- **D-40 is fixed**: the Flutter socket layer threw on connect
  (`double.infinity.toInt()`) and had been dead since April. It now connects —
  every socket feature depends on this. Do not reintroduce it.
- The real-time layer, payments, owner CTA, ID-verification event: all built,
  deployed, and watched working. E2's DoD is met.
- **Admin login works**: `admin@engirent.edu.ph` — the password is in the
  session scratchpad the user maintains, NOT in the repo. Ask the user for it;
  do not hardcode or commit it.

## E3, in order (full detail in PROGRESS.md's E3 table)

1. **E3.1 first — the token source-of-truth.** Four surfaces each have their
   own hand-authored tokens (`flutter_app/lib/core/theme/tokens.dart`, admin
   `app/theme.ts`, kiosk `theme.css`, website). **There is no single source
   that generates all four — building it is the first concrete step.** Unify
   status semantics including E2.4's verification states; PENDING is never
   red/warning. Kiosk + website are **light-only by ruling**; Flutter + admin
   are both themes.
2. **E3.2** restyles the EXISTING toast (`core/utils/toast_utils.dart`) and
   connection indicator (admin `ConnectionIndicator.tsx`) onto tokens and
   promotes them to shared — **do not rebuild their behaviour**. **D-37's
   execution lands here**: drop the socket's four `admin:kiosk_*` events (ruled
   option (b), see PROGRESS.md's D-37 section), repointing `adminRoom.test.ts`'s
   two cases at a queue event rather than deleting them.
3. **E3.3** motion tokens + reduced-motion per surface.

## Carried-forward defects (decide when to schedule)

- **D-38** — admin dashboard renders confident zeros next to "Unable to load".
  A shared-component fix (unknown ≠ 0); grep for the pattern across list pages.
- **D-39** — a profile completes with a face photo containing no face; the
  code comment claims the opposite. Server fix (`authController` completeProfile
  should require a non-null encoding). Has thesis-ethics weight.

## Still hardware-blocked (unchanged)

- **Kiosk Pi offline (B-2)**: all of E4, E0.3's wait measurements, E3's
  physical kiosk contrast check, and **S-5** — the kiosk sudo password is
  published on public `main` and must be rotated the next time the Pi is up.

## The habits this project has paid for — carry them

- Check the route, the field name, and your own harness before recording a
  defect. E1+E2 produced **nine** such traps, every one the test not the API
  (latest: id-verifications is POST not PATCH; POST /payments needs `type`).
- A green test is not a fix. Open the thing and look at it.
- The absence of an expected signal is a question to TEST, not a conclusion to
  reach for (this is how D-40 hid for four months and how ~1hr was lost before
  finding it).
- The auto-mode classifier blocks writes into `D:\ENG\EngiRent\...\src` and
  base64-to-server; the fix is a user-side `allow` rule, not reformulating.
  SSH itself is never the thing blocked — verify with `ssh … 'hostname'`.
- When the classifier refuses, surface once and stop.

## Session-length note

The run that finished E2 was **very long** (three in-fiction days). E3 is a
large phase. Prefer starting it fresh. One phase per session; `/clear` between.
