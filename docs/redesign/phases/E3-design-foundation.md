# E3 — Design Foundation

One design system across four stacks that share nothing technically
(Flutter/Material, Mantine 7, React/Vite, Next.js) but must feel like one product.

## E3.1 — Tokens that survive four stacks
- [ ] Define once (JSON/CSS custom properties), generate per surface: Mantine
      theme object, Flutter `ThemeData`, CSS vars for kiosk + website
- [ ] **Status semantics are load-bearing** — APPROVED / PENDING / RETRY /
      REJECTED, locker states, rental states, and now **verification states**
      (not submitted / pending review / verified, from E2.4). Same meaning on
      all four surfaces. **PENDING is never red or warning-yellow**
- [ ] **Both themes, per E0.2b's ruling** — tokens must resolve for light and
      dark independently, including elevation (dark UIs use surface lightness,
      not shadow) and status colours that keep their meaning in both
- [ ] WCAG AA contrast on every pairing, **computed separately per theme** —
      passing light proves nothing about dark; kiosk verified at standing
      distance in real corridor lighting
- [ ] **Interaction states are token'd once, here** — default/hover/focus/
      active/disabled/selected. Capture them on the reference screen so
      individual screens don't each have to re-verify them
      (`STATE-MATRIX.md` §4). **The kiosk has no hover** — its states must all
      be visible at rest
- [ ] Kiosk: larger type scale, 64px minimum touch targets

## E3.2 — Shared component semantics
- [ ] Status chip per state — four implementations, one meaning
- [ ] Locker representation — appears in app, admin, and kiosk; same model,
      numbering, states
- [ ] **Toast/snackbar** — E2.3 already built this working. **Restyle onto
      tokens and promote to a shared component; do not rebuild its behaviour**
- [ ] **Connection-state indicator** — same: E2.2 built it working, this
      phase makes it token'd and shared
- [ ] Three loading primitives per `ANIMATION-AND-LOADING-SPEC.md` §1:
      determinate (known duration), staged (named stages), indeterminate (short)

## E3.3 — Motion vocabulary
- [ ] Durations/easing as shared tokens
- [ ] Reduced-motion per surface (`prefers-reduced-motion`; Flutter's
      `MediaQuery.disableAnimations`)

## Definition of done
- [ ] Tokens generate into all four stacks
- [ ] A reference screen per surface renders every token and every status state
- [ ] Contrast verified computationally; kiosk verified physically
