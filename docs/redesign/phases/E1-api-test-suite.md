# E1 — Full API + Socket Test Suite

**Goal:** make "the API is proven working" repeatable and automated instead of
true-because-someone-remembers. Build per `API-TEST-PLAN.md` in full.

- [ ] Extend the existing real-HTTP `scripts/e2e-*.mjs` approach — **not** the
      mocked-Prisma unit tests, which proved less useful in practice
- [ ] Every endpoint gets the five minimum cases (happy path, missing auth,
      wrong role, malformed body, self-action rejection where applicable)
- [ ] Every specifically-risky item in `API-TEST-PLAN.md` gets a named test —
      the kiosk session trust boundary especially: **test it by attacking it**
- [ ] Socket emit/consume audit — every emitted event needs a consumer, every
      listener needs an emitter
- [ ] **Watch the self-action tests fail before fixing them** (D-3's
      generalization) — a test that never failed proves nothing
- [ ] One command runs the suite; documented in the README
- [ ] Endpoint register in `docs/PROGRESS.md` filled in, failures named

## Definition of done
- [ ] Full coverage per the plan; suite runs clean or every failure is
      recorded and attributed
- [ ] Socket audit complete, unconsumed events listed for E2
