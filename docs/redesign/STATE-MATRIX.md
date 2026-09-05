# STATE-MATRIX.md — Every State of Every Screen

A screen isn't one picture. The earlier "six states" rule (loading, empty,
locked, error, offline, saving) covered *data* states and nothing else — not
what happens when you switch themes, hover a control, tab through with a
keyboard, or view it as a different kind of user. This file replaces that rule
with the full matrix.

**First, a thing to verify in E0, because nothing in `Implemented.md` answers
it:** does dark mode actually exist on any surface today? Mantine 7 (admin)
and Flutter (`ThemeData`) both support it natively, so it may be partially
present without being deliberate — which is worse than absent, because it
half-works. **E0 must determine, per surface: does dark mode exist, is it
complete, and is it a supported feature or an accident?** Everything in §3
below depends on that answer, and if the ruling is "we don't support dark
mode," then §3 becomes "verify it's genuinely disabled, not half-rendered."

---

## 1. Tier A — required for every screen, no exceptions

Captured, verified, and part of PASS. Where a state is impossible for a screen
(a static page has no "saving"), write **N/A + why** — don't leave it blank.

### Data states
- **Loading** — skeleton matching the real layout, not a centred spinner
- **Empty** — real copy and a next action, never a bare "No data"
- **Populated** — the normal case
- **Error** — says what happened and how to fix it
- **Offline / disconnected** — with the connection indicator from D-4
- **Saving / submitting** — controls disabled, progress visible

### Theme states
- **Light**
- **Dark** (pending E0's ruling — see above)
- **System-following**, if the app offers it

### Motion
- **Reduced motion** — animations frozen to end state, not slowed

### Viewports
- **1440×900** and **390×844** (kiosk at its real resolution instead)

---

## 2. Tier B — required where the screen has them

### Interaction states, per interactive element
- **Default · Hover · Focus (keyboard) · Active/pressed · Disabled · Selected**
- **Focus is the one most often missed and the one that matters most** — this
  app must be keyboard-navigable, and a focus ring that only exists by
  browser default will disappear the moment a component is restyled
- **The kiosk has no hover** — it's a touchscreen. Any kiosk affordance that
  only appears on hover is a bug, not a state. Every interactive state there
  must be visible at rest

### Permission / role states — the same screen, different viewer
- Logged out · logged in but **unverified** · verified
- **Owner viewing their own item** (D-3: no Rent button; owner actions instead)
- Renter vs owner on a rental detail
- **Reviewer vs Admin** in the console (E6.2's client-side gating)

### Verification states (D-1) — three, everywhere they appear
- Not submitted · **pending review** · verified
- Pending is a real state here because a human reviews it. **Never styled as
  an error.**

### Outcome states — three, never two
- ML item verification: **APPROVED (≥85) · PENDING (60–84) · RETRY (<60)**
- Disputes: open · under review · settled
- Same rule as `ANIMATION-AND-LOADING-SPEC.md` §3 — PENDING is not a failure
  variant and doesn't get failure colour

### Real-time states (D-4)
- **Live · reconnecting · offline** — and what the screen does when a socket
  event arrives *while the user is looking at it*. Does the list reorder under
  their finger? Does an open detail update mid-read? Decide deliberately per
  screen; "it just re-renders" is a decision made by accident

### Content-extreme states
- Longest realistic name/title (overflow, truncation, wrapping)
- Zero items · one item · many items (does the list virtualise?)
- Longest realistic message/review body
- **Missing images** — a listing with no photo, a broken image URL. Given
  `Implemented.md`'s note that Render's ephemeral storage already orphaned
  some image paths, this is a live case, not a hypothetical

---

## 3. Theme switching — the specific things that break

Switching theme is not just "swap the palette," and these are the failures to
look for rather than assume:

- [ ] **Hardcoded colours** that don't switch — the single most common bug.
      Grep for literal hex/`Colors.` values outside the token layer
- [ ] **Contrast that passes in light and fails in dark** (or the reverse).
      Both themes need computed WCAG AA verification independently — passing
      one proves nothing about the other
- [ ] **Status colours** — APPROVED/PENDING/RETRY, locker states, verification
      states must stay distinguishable *and keep their meaning* in both. A
      PENDING that reads as a warning in dark mode has broken §2's rule
- [ ] **Images and illustrations** — empty-state art, icons, logos on a dark
      background. Transparent PNGs with dark strokes vanish
- [ ] **Elevation and shadows** — dark UIs typically use surface lightness
      rather than shadow for depth; a shadow-based card system usually reads
      flat in dark
- [ ] **Switching live** — does the app re-render cleanly mid-session, or does
      it need a restart? Are open modals/sheets/toasts updated too?
- [ ] **The kiosk** — a fixed device in a corridor. Decide whether it has a
      theme at all, or is permanently one. Probably permanently one; **state
      that decision rather than leaving it implicit**

---

## 4. How to capture this without producing 900 screenshots

The matrix is large; the capture set doesn't have to be. Be deliberate:

**Always capture as images** (`VISUAL-EVIDENCE.md`):
- Populated · empty · error, in **both themes**, at **both viewports**

**Capture selectively:**
- Loading, saving, offline — one representative screen per surface, not all
- Interaction states — capture the **component** once in E3's reference
  screen, not on every screen that uses it. That's the point of shared
  components
- Permission variants — only on screens where the difference is real (item
  detail as owner vs. non-owner; console pages as Reviewer vs. Admin)
- Content extremes — the worst case per screen type (one long-name list, one
  long-body message view), not every screen

**Assert, don't screenshot:**
- Focus order and focus-ring presence → Playwright keyboard assertions
- Contrast → computed checks in CI, both themes, not eyeballed
- Reduced motion → assert durations are zero, don't compare images

**In the register**, each screen carries a states line, so gaps are visible:

```
STATES  data ✓6/6 · themes ✓L ✓D · viewports ✓2 · reduced-motion ✓
        roles ✓owner ✓non-owner · realtime ✓live ✓reconnect
        extremes ✓long-title ✗missing-image (no fixture yet)
```

A screen missing Tier A states is `FAILED`. A screen missing a Tier B state
that genuinely applies to it is `FAILED`. A screen with `N/A + why` is fine —
that's a decision, not a gap.
