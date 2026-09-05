# USER-JOURNEY-SIMULATION.md
### Read this before any design work. Every template choice in `TEMPLATE-LINKS.md` traces back to a moment in this file.

This is a simulation of what people actually **see, hold, touch, and wait for**
when they use EngiRent — derived from the real implemented API surface,
socket events, and hardware behaviour in `Implemented.md`, not from what a
rental app is generally assumed to do. Where the current implementation makes
a moment awkward or invisible, this file says so plainly rather than
describing an idealised version.

Four surfaces, four different physical situations:

| Surface | Where the person physically is | What they're holding |
|---|---|---|
| Flutter app | Anywhere on campus, walking, or standing at the kiosk | Their own phone, one-handed, possibly outdoors in sunlight |
| Kiosk UI | Standing in front of a Raspberry Pi touchscreen in a corridor | Nothing — hands may be full of the item they're returning |
| Admin console | Sitting at a desk | Mouse and keyboard, dual monitor likely |
| Public website | Anywhere, deciding whether to trust this thing at all | Phone or laptop |

---

## Journey A — Maya rents a theodolite (renter, first time)

**A1. Discovery — public website, on her phone, between classes.**
She's heard about EngiRent from a classmate. She sees the landing page, and
the only question she's actually asking is *"is this real, and will I get my
deposit back?"* Everything else is secondary. The site has real content
(home/about/pricing/docs/blog, a genuine dated engineering journal).
**Design consequence:** trust is the job of this page, not feature listing.

**A2. Registration and verification — Flutter app.**
`POST /auth/register` (email, password ≥8, studentId, firstName, lastName,
phone) → `POST /auth/profile/complete` → `POST /auth/id-photo` → **`POST
/auth/register-face`**, which proxies to the ML service and extracts a
128-float dlib encoding from a selfie.

**This is the highest-anxiety moment in the entire product** and the current
design almost certainly under-serves it. She is being asked to hand over a
photo of her face and her student ID to an app she installed twenty minutes
ago. What she needs to see: *why* it's needed (it's what unlocks the physical
locker later — that's a genuinely good reason and it isn't being told to
her), where the photo goes, and that it isn't shared.
> **⚠ CORRECTED 2026-09-06 — this screen already exists, and it is thorough.**
> Captured from the running app: profile setup opens on **"Verify your identity
> — STEP 1 OF 3, Before we start"**, which states *why*
> ("EngiRent lockers open with your face"), **what we collect** (a face template
> — *"converted into a numeric encoding… does not send your photo anywhere at
> collection time"* — and a student ID photo), **your rights** ("Not visible to
> other students", "Withdraw at any time"), an optional guardian contact, and an
> explicit biometric-consent checkbox that gates a disabled "Agree and
> continue". Step 2's footer repeats the reason. Evidence:
> `design/before/flutter-profile-setup-1-consent*.png`. **E5.1 should not build
> this.**

**Design consequence (SUPERSEDED — see the correction above):** face
registration needs an explanation screen before the camera opens.

**A3. Browsing — Flutter app, one-handed, walking.**
`GET /items` with optional auth. She filters, taps an item, sees
`GET /items/:id` and `GET /items/:id/booked-dates`.
**Design consequence:** the booked-dates endpoint exists and is real — the
calendar showing *unavailable* dates is a first-class UI element, not a
detail. Nobody wants to pick a date and be told no afterwards.

**A4. Booking and payment — Flutter app.**
`POST /rentals` → `POST /payments`. **Right now this lands on a mock checkout
page** (`${CLIENT_WEB_URL}/payments/mock?tid=...`) because no
`PAYMONGO_SECRET_KEY` is configured. It's a documented, gated fallback, not
a bug — but it means the single most trust-sensitive screen in the product is
currently a placeholder.
**Design consequence:** the mock checkout screen still needs to look
deliberate and clearly labelled as a test payment. A half-designed mock is
what a grader or a pilot user will remember. It also needs a real design for
when the live key lands.

**A5. Arriving at the kiosk — this is the moment the whole architecture turns on.**
She walks to the physical kiosk. **The kiosk screen is displaying its own QR
code** (`GET /api/qr-token`, format `KIOSK-001:{token_id}:{timestamp}:{signature}`,
90-second TTL, HMAC-signed, regenerating). She opens the app's scan screen
and points her phone at the kiosk screen.

Note the direction: **the kiosk shows, the phone scans.** (The reverse flow —
kiosk scanning the phone — is vestigial dead code, `QrScreen`/`ConfirmScreen`,
because the kiosk's camera was physically removed 2026-09-03.)

Her phone emits `app:kiosk_scan` → Node relays `kiosk:session_validate` → **the
kiosk itself** checks the token against the one it currently has live, inside
the 90s TTL, and burns it on use. That check is the one real moment "a human
is physically standing here right now" becomes true. (It does **not**
recompute the signature — corrected 2026-09-06 in E1; the identity match is
the stricter check of the two, since a correctly-signed token that was never
issued is still refused.)

**Design consequence, and it's the biggest one in this document:** for a few
seconds, Maya is looking at **two screens at once** — her phone and the kiosk
— and they must never disagree. If the kiosk says "scanning…" while her phone
says "connected," she doesn't know which to believe, and she's standing in a
corridor holding a heavy instrument. **Every state in this handoff must be
mirrored on both screens simultaneously, and the phone should tell her to
look up at the kiosk when the kiosk is the thing that matters.** This is a
two-device choreography problem, not two independent UIs.

**A6. Face verification — on her phone, standing at the kiosk.**
`kiosk:flow_start` → Node resolves who must verify **from rental status
alone** (`resolveFaceSubject` — never from client input), opens a 120-second
server-side session, emits `kiosk:face_required` to her phone. The kiosk shows
a plain waiting screen — it has no camera any more.

She takes a selfie (`face_verify_screen.dart`, front camera, oval framing
guide) → `POST /kiosk/verify-face` → Node calls the ML service server-side →
distance threshold 0.5 → locker opens.

**Design consequences, several and specific:**
- A **120-second session expiry** is running. She cannot see it. She should —
  a calm countdown, not a panic timer.
- **4 attempts max** before a forced re-scan. Attempt 2 of 4 should be visible,
  and failures return in the HTTP response (deliberately not via socket, so
  retrying doesn't disturb the screen underneath) — so the retry UI can be
  smooth and local, which is a design opportunity the architecture already paid for.
- Verification **fails closed** if the ML service is unreachable. That's the
  right call, but "fails closed" with a generic error message is cruel when
  someone is standing in front of a locker. This needs a specific,
  non-blaming message that makes clear it's the system's fault, not her face.
- Lighting in a corridor is not studio lighting. The oval guide should give
  live feedback (too dark / hold still), not just frame a shot that will fail
  server-side seconds later.

**A7. The locker opens.** Relay fires, solenoid releases, actuator extends.
**Timing is real and hand-calibrated per locker** — locker 1 runs 15/15/22/22s
extend/retract/open/close; locker 2 runs 5/5/21/21s. **These are genuinely
different, by up to 17 seconds.**
**Design consequence:** a fixed-duration "opening…" animation will desync from
real hardware on most lockers. The animation must be driven by actual socket
state, and for the long ones (22s), a progress indication that doesn't feel
broken. 22 seconds of an indeterminate spinner feels like a crash.

**A8. Return.** Same handoff, plus the ML item-comparison pipeline: quality
gate → pHash → traditional CV → SIFT+RANSAC → SSIM → ResNet50 → OCR.
**Thresholds: ≥85 APPROVED, 60–84 PENDING (manual review), <60 RETRY (up to
10 attempts) then REJECTED.**
**Design consequence:** three genuinely different outcomes, and the middle one
("a human will review this") is the one most likely to be misread as "you did
something wrong." PENDING needs its own designed state, not a variant of
failure. And 10 retry attempts is a lot of a person's time — show which
attempt they're on and what would make the next one better.

---

## Journey B — Ken lists his own equipment (owner)

`POST /items` (requires auth **+ verified**) → item appears in `GET /my-items`.
When someone rents it, Ken does a **deposit** flow at the kiosk — same QR
handoff, same face verification, but `resolveFaceSubject` picks *the owner*
for a deposit and the renter otherwise.

**Design consequence:** the same physical screens serve two different people
with different intentions. The kiosk's waiting screen should name who it's
waiting for in a way that's unambiguous when two people are standing there.

Ken also gets `GET /rentals/:id/conversation` and can message the renter, and
after return, `POST /reviews`. Payout goes to `PUT /auth/payout-destination`.

---

## Journey C — the admin, at a desk, dealing with a dispute

18 real pages, all hitting real endpoints. The two that matter most:

**Disputes.** Currently a **read-only priority queue.**
`POST /admin/rentals/:id/settle` exists server-side and is even mocked in the
demo adapter — **but no page calls it.** So an admin can see a dispute and
cannot resolve it from the UI. This is the single clearest
functionality-to-design gap in the product: a working backend capability with
no front door.

**Kiosk control.** Per-locker camera/door/actuator controls, timing config,
live log stream via SSE, 4 locker tabs. This is a page where someone is
operating **physical hardware remotely** — a mis-click opens a real locker in
a real corridor.
**Design consequence:** destructive physical actions need confirmation
proportional to their consequence, and live state needs to be unmistakably
live (an SSE stream that silently died must look dead, not idle).

Also: **there is no client-side role enforcement anywhere.** The
Reviewer-vs-Admin split exists server-side only. A Reviewer currently sees
buttons they may not be able to use.

---

## Cross-cutting observations that should drive design work

1. **The two-screen handoff (A5–A7) is the product's signature moment** and
   currently the least designed. Everything else is a competent app; this is
   the part nobody else has.
2. **Three long waits exist and none are currently designed as waits:** locker
   actuation (up to 22s, hardware-driven), ML item verification (a real
   multi-stage pipeline), face verification round-trip. Each needs a real
   loading treatment, and two of them can show genuine progress rather than a
   spinner.
3. **PENDING is a first-class outcome, not a failure**, in both item
   verification (60–84) and dispute review. It currently has no distinct
   design language.
4. **Localization is a veneer** — 32 keys covering auth, bottom nav, and the
   home dashboard's rental section; ~20 other screens are hardcoded English
   regardless of the selected language. A user who picks Cebuano gets Cebuano
   for two screens and English for the rest, with nothing marking it
   incomplete. That's worse than not offering it.
5. **Payments are a mock right now.** Design for both states.
6. **Nothing in the app tells the user what "verified" means** even though
   verification gates listing items and unlocking lockers.
