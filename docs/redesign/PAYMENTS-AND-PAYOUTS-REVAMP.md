# PAYMENTS-AND-PAYOUTS-REVAMP.md

**Status: GAP + IMPLEMENTATION SPEC. Not built.** Recorded 2026-09-06.
Register: **D-21, D-23, D-25, D-26, D-27, D-28**. Pricing/commission is specced
separately in `COMMISSION-AND-PRICING.md`.

---

## 1. Read this first — what already exists

Two of the items requested are **already built**, and specifying them again
would repeat the mistake this track has already made twice (`My Rentals` and the
face-registration consent screen were both "missing" in the docs and shipped in
the code).

| Requested | Reality |
|---|---|
| "A new page for the user to input bank details / GCash for InstaPay" | **`payout_details_screen.dart` exists and is complete** — InstaPay/PESONet rail choice with an explanation of each, an institution dropdown fed by `GET /payments/receiving-institutions`, account-holder name, account number, an encrypted-at-rest warning, and `PUT /auth/payout-destination`. Captured: `design/before/flutter-payout-details.png`. **It is not missing — it is broken**, because the institution list 404s (Disbursements not enabled, D-21). It needs a *revamp*, §6, not a rebuild |
| Storage for those details | `User.payoutProvider` / `payoutBic` / `payoutInstitutionName` / `payoutAccountName` / `payoutAccountNumber` all exist. The account number is **AES-256-GCM encrypted**, same scheme as `faceEncoding` |

What genuinely does not exist: the **commission split** (D-27), the **manual
payout mode** (§7), **money-timing notifications** (§5), and a **balance/ledger
model the owner can understand** (§4).

---

## 2. Two payout modes, chosen per owner

The owner picks how they get paid. This is the "if the owner decides that way of
payment" requirement.

| Mode | How it works | When to use |
|---|---|---|
| **AUTOMATIC** | PayMongo Disbursement to the owner's saved bank/e-wallet. Fully hands-off | Once PayMongo enables Disbursements on the account |
| **MANUAL** | Admin sends the money themselves (GCash, bank app), then records it against the rental | **Works today.** No Disbursements enablement, no ₱10 transfer fee, no ₱80 minimum, no clearing wait beyond the platform's own |

```prisma
model User {
  payoutMode  PayoutMode @default(MANUAL)   // AUTOMATIC | MANUAL
}
```

**Default to MANUAL**, because AUTOMATIC currently 404s. An owner should never be
able to select a mode the platform cannot execute — the picker must read
capability from the server, not assume it.

---

## 3. Payment route revamp

### 3.1 Fix first — these are defects, not features
- **`POST /payments` must never fail silently.** `rental_detail_screen.dart:130`
  bare-`return`s when `paymentUrl` is null, so every server-side failure is
  invisible (D-23). Replace with a real error toast naming the cause.
- **`GET /payments/receiving-institutions` must not lie.** It currently returns
  `{institutions: []}` as a **success** when unavailable, and the client renders
  "Couldn't load the list — tap to retry" — a retry that can never succeed
  (D-21). Return an explicit capability flag instead:
  `{ available: false, reason: "disbursements_not_enabled" }`.
- **Malformed JSON must return 400, not 500** (D-15) — body-parser's
  `SyntaxError` never reaches the error middleware, on *every* JSON endpoint.
- **The mock-confirm path is dead in production** (D-25): it is gated on
  `NODE_ENV !== "production"`. Either hide the mock page in production or route
  its simulate buttons through the authenticated admin `decide-payment`
  endpoint. **Do not relax the signature check** — its comment records the real
  hole it closed.

### 3.2 New / changed routes

```
GET    /payments/capabilities          → { checkout, refunds, disbursements } booleans
                                          Drives every UI that must not offer
                                          what the account cannot do.

GET    /payments/balance               → owner's own ledger: pending, available,
                                          inTransit, paid  (§4)

POST   /admin/payouts/:id/mark-sent    → MANUAL mode: admin records a payout they
                                          made by hand. Body: reference, method,
                                          amount, note. requireAdmin. Audited.

GET    /admin/payouts                  → the payout queue (§7), filterable by
                                          state and mode

POST   /admin/payouts/batch            → AUTOMATIC mode: settle N payouts in one
                                          PayMongo transfer (up to 2,500), so one
                                          ₱10 fee covers many rentals
```

---

## 4. The balance model — four states, not one number

Marketplace payout UX research is consistent on this: a seller shown a single
number cannot reason about their money, and the support load lands on the
platform. Status labels must map to **real operational states**.

| State | Meaning | Owner-facing wording |
|---|---|---|
| `PENDING_CLEARING` | Renter paid; funds not yet cleared at PayMongo | "Clearing — available {date}" |
| `AVAILABLE` | Cleared, payable, not yet sent | "Ready to send" |
| `IN_TRANSIT` | Disbursement submitted, not confirmed | "On its way" |
| `PAID` | Confirmed received | "Paid {date}" |
| `FAILED` | Genuine failure, needs action | "Couldn't send — we're on it" |

**`PENDING_CLEARING` is not a failure and must never be styled as one** — the
same rule this project already applies to ML `PENDING` and ID review. That is
the single most important thing in this section: a normal 2-banking-day wait
currently surfaces to owners as *"payout could not be sent, support has been
notified"* (D-28).

---

## 5. Money-timing notifications — both sides

Real PayMongo clearing times, not invented ones:

| Method used | Clears in |
|---|---|
| Card (Visa/Mastercard) | **3 banking days** |
| E-wallet (GCash, GrabPay, Maya, ShopeePay) | **2 banking days** |
| Bank transfer / QR Ph | **1 banking day** |

Banking days only; anything after 5pm PHT rolls to the next business day.

### To the OWNER
- **On rental completion:** "₱400 earned. Funds clear on {date} and will be sent
  to your {GCash/bank} — we'll tell you when it's on the way." Computed from the
  renter's actual payment method, not a generic string.
- **On send:** "₱400 is on its way to {institution} ••••{last4}."
- **On confirmation:** "₱400 paid."
- **MANUAL mode:** "₱400 will be sent by the EngiRent team, usually within
  {SLA}." Be honest that a human does it.

### To the RENTER
- **On payment:** "₱420 paid. Your ₱50 deposit is held and refunded after the
  return check."
- **On return approval:** "₱50 deposit refunded to your {method}. It can take
  up to {N} banking days to appear."
- **On partial refund:** state the deduction and why, in the same message.

**All of these respect `/notifications/preferences`**, which already exists —
adding push without honouring it would be the wrong order (`CAPABILITY-GAPS.md`
C-2).

---

## 6. Payout destination screen — revamp, not rebuild

Keep the existing screen. Change:

- **GCash as a first-class choice, not a dropdown entry.** Most student owners
  will use GCash; asking them to find it in a bank list is friction. Offer
  "GCash" and "Bank account" as the primary split, with the rail (InstaPay/
  PESONet) derived rather than asked — the current UI asks the user to choose a
  clearing rail, which is an implementation detail they cannot reason about.
- **Read capability from `/payments/capabilities`.** When disbursements are
  unavailable, say so plainly and offer MANUAL mode — never render a dead
  "tap to retry".
- **Show the payout mode** and let the owner switch it.
- **Show their balance** (§4) on this screen — it is where they come to ask
  "where is my money".

---

## 7. Admin manual-payout console — the new build

**Purpose:** the platform pays owners by hand, quickly, without arithmetic
errors. This is what makes MANUAL mode viable today.

**The queue** — a Mantine DataTable, one row per owed payout:

| Column | Notes |
|---|---|
| Owner | name + avatar |
| Item / rental | links to rental detail |
| Renter paid | gross, e.g. ₱420 |
| Platform fee | e.g. −₱20 (`COMMISSION-AND-PRICING.md`) |
| **Amount to send** | **₱400 — the number to type into GCash** |
| Destination | institution + masked account + **copy button** |
| State | §4 |
| Action | **Mark as sent** |

**The built-in calculator** — expanding a row shows the full arithmetic, because
someone typing a number into a banking app needs to trust it:

```
Renter paid                     ₱420.00
  Rental (₱400/day × 1 day)     ₱400.00
  Platform fee (₱20/day × 1)     ₱20.00
Deposit held (refunded separately) ₱50.00   ← never part of the payout
─────────────────────────────────────────
Owner receives                  ₱400.00
Send to: GCash •••• 4821  (Juan Dela Cruz)
```

**Mark as sent** requires a **reference number** and method, writes a `PAID`
transaction row, notifies the owner, and records an `AuditLog` entry.
`requireAdmin`, never `requireStaff` — moving money is not a Reviewer action.

**Also needed:** a totals bar (owed today / this week), batch select for
AUTOMATIC mode (one ₱10 fee, up to 2,500 payouts), and a **"do not double-pay"
guard** — marking sent must be idempotent and visibly disabled once paid. That
guard matters more than it sounds: this is the one screen where a mis-click
costs real money and cannot be undone.

---

## 8. Templates

| Surface | Template | Take |
|---|---|---|
| Admin payout queue | [mantine-analytics-dashboard](https://github.com/design-sparx/mantine-analytics-dashboard) — its **invoices** module | Row density, status chips, detail drawer. Use its **Mantine 7 branch**, not `main` (now Mantine 8 / Next 16) |
| The table itself | [Mantine DataTable](https://icflorescu.github.io/mantine-datatable/) | Row expansion for the calculator, batch selection, sticky totals |
| Secondary reference | [nextjs-mantine-dashboard](https://github.com/qqharry21/nextjs-mantine-dashboard) (Mantine 7 / Next 14) | Closer to this project's stack than the primary's `main` |
| Approval-queue interaction | [Mantine Admin](https://github.com/jotyy/Mantine-Admin) | Confirm-before-act patterns |
| Balance/ledger UX | [Stripe — Marketplace payouts](https://stripe.com/resources/more/marketplace-payouts) · [Unified Balance Kit: pending & funds-in-motion states](https://www.arc.io/blog/unified-balance-kit-designing-for-pending-and-funds-in-motion-states) · [Marketplace payout ledger](https://fynex.ai/blog/marketplace-payout-ledger/) | **Concepts, not pixels:** separate pending from available, name real operational states, show the ledger not one number |

`TEMPLATE-LINKS.md` Surface 2 gains rows for **Payout queue** and **Payout
detail/calculator**; Surface 1's **Payout destination** row gains the revamp
note. Both are ordinary rows under the existing gate.

---

## 9. Testing

Per `API-TEST-PLAN.md`'s five cases, plus:
- `ownerPayout + platformFee === gross`, exactly, no rounding drift
- Deposit is never included in a payout
- Clearing date computed correctly per payment method, including the 5pm and
  weekend rollovers
- `PENDING_CLEARING` never renders with failure styling
- **Mark-as-sent is idempotent** — double submission cannot double-pay
- Reviewer role → 403 on every payout action
- Capability endpoint drives the UI: with disbursements off, no screen offers
  AUTOMATIC mode
