# E3 — Design Foundation

One design system across four stacks that share nothing technically
(Flutter/Material, Mantine 7, React/Vite, Next.js) but must feel like one product.

> **KEPT CURRENT UNDER G9 (added 2026-09-11).** Unlike E0-E2, which had to be
> reconciled retroactively by P-1, this file is ticked as work lands. Three
> states, and they stay distinguishable: **[x]** done with evidence,
> **[ ] + RULED** for a decision, **[ ] + OPEN** for genuinely outstanding.

---

## E3.1 — Tokens that survive four stacks
- [x] ~~Define once (JSON/CSS custom properties), generate per surface: Mantine
      theme object, Flutter `ThemeData`, CSS vars for kiosk + website~~
      — **DONE.** `design/tokens/tokens.json` is the single source;
      `design/tokens/build.mjs` generates `design-tokens.g.ts` (admin),
      `design_tokens.g.dart` (Flutter) and `design-tokens.g.css` (kiosk,
      website). **All four surfaces consume them and all four were verified on
      screen.** `build.mjs --check` is an anti-drift guard, proven in both
      directions.
- [x] ~~**Status semantics are load-bearing** — APPROVED / PENDING / RETRY /
      REJECTED, locker states, rental states, and now **verification states**
      (not submitted / pending review / verified, from E2.4). Same meaning on
      all four surfaces. **PENDING is never red or warning-yellow**~~
      — **DONE, and verified rather than asserted.** All **26** states parsed
      out of `tokens.json`, `design-tokens.g.ts` and `design_tokens.g.dart` and
      compared: **0 disagreements**, `PENDING → review` (cyan-teal `#0E9BB8`
      light / `#33B6D1` dark) in all three. The guard was tested by injecting
      `PENDING: review → warning` and watching `build.mjs --check` report
      STALE — that is **D-42**'s exact regression caught mechanically.
      **"All four surfaces" was corrected to two** — see the status-chip row
      in E3.2.
- [x] ~~**Both themes, per E0.2b's ruling** — tokens must resolve for light and
      dark independently, including elevation (dark UIs use surface lightness,
      not shadow) and status colours that keep their meaning in both~~
      — **DONE.** Light and dark resolve independently in the token source, and
      the surface→theme matrix follows E0.2b: **Flutter and admin both themes,
      kiosk dark-only, website light-only**. Verified on the Flutter reference
      screen in both themes 2026-09-09.
- [ ] WCAG AA contrast on every pairing, **computed separately per theme** —
      passing light proves nothing about dark; kiosk verified at standing
      distance in real corridor lighting
      — **HALF MET.** *Computed per theme*: **done**, and it found **D-41**
      (25 of 28 admin chips under 4.5:1) and **D-46** (admin inputs at 1.42:1,
      never on a token at all); re-measured off the rendered DOM, 0 failing.
      WCAG **1.4.11** swept across all four surfaces separately.
      *Kiosk at standing distance in real corridor lighting*: **measured on the
      real panel 2026-09-10** (6.64:1–17.70:1, all PASS) **but against the
      PRE-redesign build** — the Pi ran `main@1546cd6`. The palette measured is
      substantially E3.1's (E3.1 preserved the kiosk's dark resolution), but
      the 1.25× type scale and `borderStrong` outlines were not on the device.
      **OPEN until re-measured against the redesigned UI. Pi-blocked (B-2).**
- [x] ~~**Interaction states are token'd once, here** — default/hover/focus/
      active/disabled/selected. Capture them on the reference screen so
      individual screens don't each have to re-verify them
      (`STATE-MATRIX.md` §4). **The kiosk has no hover** — its states must all
      be visible at rest~~
      — **DONE.** `--focus-ring-*`, `--active-overlay`, `--selected-overlay`
      and `--disabled-opacity` are generated tokens consumed by all four
      surfaces. Flutter's pressed state was verified by pixel measurement, not
      by eye (`#4DA3E8 → #4595D3` under a held press) — and the first
      measurement was **wrong**, having accidentally submitted the form; G8
      caught it. The kiosk's at-rest `:active` state is **D-49**.
- [x] ~~Kiosk: larger type scale, 64px minimum touch targets~~
      — **DONE in code; physically unverified.** `--touch-min:
      clamp(64px, 7vmin, 96px)` and the `--t-*` steps are generated as
      `kiosk.typeBase × kiosk.typeScaleMultiplier` (1.25) — which is how that
      multiplier finally reached a pixel; **it had no consumer before and was a
      silent orphan** (same family as D-43). Not yet seen on the panel: the Pi
      runs the pre-redesign build.

## E3.2 — Shared component semantics
- [x] ~~Status chip per state — four implementations, one meaning~~
      — **DONE 2026-09-10, and the bullet was WRONG: it is TWO implementations,
      not four.** Only **Flutter and admin** render the 26-state rental
      vocabulary. The **kiosk** renders a different vocabulary entirely (bay
      free/in-use, session-QR connected/waiting) and the **website** renders
      none (only HTTP codes and a `status=paid` query param). Writing a rental
      status chip for those two would have been inventing a need. The repo won
      over the doc, which is the rule.
- [ ] Locker representation — appears in app, admin, and kiosk; same model,
      numbering, states
      — **OPEN, and partly delivered as D-53.** The kiosk half is done: it now
      receives the server's canonical `LockerStatus`
      (`AVAILABLE | OCCUPIED | RESERVED | MAINTENANCE | OUT_OF_SERVICE`)
      instead of inferring availability from door-lock state, and **absent
      renders as UNKNOWN, never as free**. Node emits `kiosk:occupancy`
      (deployed and proven live 2026-09-11). **Still open:** the kiosk half is
      not deployed (Pi offline, B-2), and app/admin have not been brought onto
      one shared locker model.
- [x] ~~**Toast/snackbar** — E2.3 already built this working. **Restyle onto
      tokens and promote to a shared component; do not rebuild its behaviour**~~
      — **DONE, behaviour untouched as instructed.** Restyled onto tokens, and
      the two auth screens that were bypassing `AppToast` with raw SnackBars
      now use it: **`showSnackBar` is 0 across `lib/`.**
- [x] ~~**Connection-state indicator** — same: E2.2 built it working, this
      phase makes it token'd and shared~~
      — **DONE.** Tokenized, and it fixed **D-50**: "Connecting…" rendered
      warning-amber, implying a problem during a normal connect; it now uses
      `review`.
- [ ] Three loading primitives per `ANIMATION-AND-LOADING-SPEC.md` §1:
      determinate (known duration), staged (named stages), indeterminate (short)
      — **BUILT AND VERIFIED ON SCREEN for the KIOSK 2026-09-11; the PHONE half
      is OPEN.** `kiosk_ui_react/src/components/loading/` holds all three,
      token-only, verified at 1080×1920 across 6 cases (determinate 19/66/38%
      fills with real "12s/5s/3s remaining"; both indeterminate cases with **no
      number shown**; staged with 7 stages, **0 done, 0 active**).
      They also gave the kiosk its **first ever UI for its hardware waits** —
      the Pi emits 13 statuses and the UI branched on 6, so a 15s door and a
      34–46s actuator sequence ran with the main menu on screen.
      **Still open:** (a) `socket_client.py` must send `duration_seconds` so
      the determinate bar has a real duration — until then these render
      indeterminate, never a guessed bar (Pi-blocked, B-2); (b) the **phone
      side** — §1.3's 120s session countdown does not exist, and §1.1's
      mirrored progress is a static `'Opening a locker…'` string.

## E3.3 — Motion vocabulary
- [ ] Durations/easing as shared tokens
- [ ] Reduced-motion per surface (`prefers-reduced-motion`; Flutter's
      `MediaQuery.disableAnimations`)

## Definition of done
- [x] ~~Tokens generate into all four stacks~~ — **DONE**, all four verified
      on screen.
- [x] ~~A reference screen per surface renders every token and every status state~~
      — **DONE.** Finding **D-44** on the way: the Flutter reference screen's
      own documented invocation was a no-op — `bool.fromEnvironment` accepts
      only `"true"`/`"false"`, so the `=1` the repo told you to use silently
      booted past it.
- [ ] Contrast verified computationally; kiosk verified physically
      — **HALF MET**, same split as the E3.1 contrast row: computed is done and
      found D-41 and D-46; physical was measured on the real panel but against
      the **pre-redesign** build. **Pi-blocked (B-2).**
