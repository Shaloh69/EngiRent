# API-TEST-PLAN.md — Full API Testing, Mandatory

## Why this is a phase and not a task

Current automated coverage, from `Implemented.md`:

| Surface | Tests |
|---|---|
| Node API | 4 of ~10 controllers, **fully mocked Prisma**, no integration tests |
| ML service | 5 tests, all on the API-key gate — **none** on the comparison algorithm, thresholds, or SSRF guard |
| Admin console | **Zero.** No test files, no tooling, no test script |
| Flutter app | 2 unit tests across 24 screens. No widget or integration tests |

Real coverage today comes from `scripts/e2e-*.mjs` — real HTTP against a live
server, **run by hand**, not in CI. That's genuinely better than nothing (and
better than the mocked unit tests, for catching real breakage), but it only
runs when someone remembers.

**Most of the API is proven working in practice**, especially the hardware
path — that's established. This phase exists to make that provenness
*repeatable and automated*, and to catch the class of bug `DEFECTS-AND-GAPS.md`
found by hand.

## Coverage requirement — every endpoint, no exceptions

Build on the existing `scripts/e2e-*.mjs` approach (real HTTP, real DB)
rather than expanding the mocked-Prisma unit tests — the mocks proved less
useful in practice. Every endpoint gets, at minimum:

- [ ] Happy path with valid auth
- [ ] **Missing auth** → correct 401
- [ ] **Wrong role** → correct 403 (this is where the Reviewer/Admin split
      gets tested, since the admin UI doesn't enforce it — server-side is the
      only real boundary)
- [ ] Malformed body → clean 400, not a 500
- [ ] **Self-action rejection where applicable** — this is `DEFECTS-AND-GAPS.md`
      D-3's generalization. Explicitly test: renting your own item, reviewing
      your own item, messaging yourself. **Watch these fail first**, then fix

Endpoint groups (from `Implemented.md` §3.1): auth (11), items (7), rentals
(7), payments (6), kiosk (7), notifications (5), reviews (4), feedback (2),
admin (~33), upload (2), media (3), plus `/app-config` and `/health`.

## Specific things that need tests because they're specifically risky

- [ ] **`ML_API_KEY` unset → ML endpoints unauthenticated.** Test that the
      gate actually rejects when the key IS set, and assert loudly in the
      test suite if the deployed config has it unset
- [ ] **The dlib fallback path.** If `face_recognition` fails to import,
      `register_face` always returns `success: false` — silently blocking all
      profile setup. Test both modes explicitly
- [ ] **The two retired endpoints** (`POST /kiosk/claim`, `/kiosk/return`) —
      assert current behaviour, and update the test when E0 rules on
      400-vs-410
- [ ] **PayMongo webhook signature verification** — reject an unsigned/bad-HMAC payload
- [ ] **Kiosk session store** — `/kiosk/verify-face` must reject a caller who
      isn't the session's own user, and must never accept a client-supplied
      kiosk ID. This is the system's actual trust boundary; test it by
      attacking it
- [ ] **4-attempt cap** on face verification per session; **120s expiry**
- [ ] **QR token TTL (90s) and signature** — expired and forged tokens rejected
- [ ] **ML thresholds** — 85/60 boundaries produce APPROVED/PENDING/RETRY
      correctly, including exactly-at-boundary values
- [ ] **The OCR +10 bonus** (`hybrid.py:251-252`) — assert it can't push a
      sub-85 comparison over the auto-approve line on an OCR match alone,
      or if it can, that this is a deliberate documented decision

## Test the socket surface too

`Implemented.md` §3.2 lists every event the server listens for and emits.
- [ ] Every **emitted** event has at least one consumer somewhere — this is
      `DEFECTS-AND-GAPS.md` D-4's root cause, made testable
- [ ] Every **listened-for** event has a real emitter (`kiosk:face` is known
      dead — assert it stays dead or is removed)
- [ ] Reconnect behaviour: disconnect mid-session, reconnect, confirm state
      is refetched rather than silently stale

## Definition of done

- [ ] Every endpoint in §3.1 covered by the five minimum cases above
- [ ] Every risky item above has a named test
- [ ] Socket emit/consume audit complete, gaps listed
- [ ] The suite runs with one command and is documented in the README
- [ ] Results recorded in `docs/PROGRESS.md` — including any endpoint that
      **fails**, named, not quietly fixed and forgotten
