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

## Definition of done
- [ ] Every beat implemented on both screens, verified on real hardware
- [ ] Screenshot pairs on disk for every beat, both screens
