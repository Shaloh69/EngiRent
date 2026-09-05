# COMMISSION-AND-PRICING.md — Platform Fee, and Admin Rate Editing

**Status: GAP + IMPLEMENTATION SPEC. Not built.** Recorded 2026-09-06 from the
user's stated business model. Register entry: **D-27**.

---

## 1. The model

The platform takes a **flat markup per item**, not a percentage.

| | |
|---|---|
| Owner's rate | **₱400 / day** — what the lister sets and what they receive |
| Platform fee | **₱20 flat, ONCE PER RENTAL** — admin-editable, **not** per day |

**Worked examples** (user-confirmed 2026-09-06):

| Duration | Owner receives | Platform fee | Renter pays |
|---|---|---|---|
| 1 day | ₱400 | ₱20 | **₱420** |
| 4 days | ₱1,600 | ₱20 | **₱1,620** |
| 7 days | ₱2,800 | ₱20 | **₱2,820** |

The fee does **not** scale with duration. The platform's revenue per rental is
flat, which has consequences for both display (§7) and margin (§8).

## 2. What exists today

**Nothing.** `rentalSettlementService.ts:177` pays the owner
`rentalPaymentTxn.amount` — the **full** amount the renter paid. A repo-wide
search for `commission` / `platformFee` / `serviceFee` / `markup` / `take_rate`
across `server/node_server/src` returns no results. As built the platform earns
**zero**, and enabling PayMongo Disbursements without this change would send the
owner 100% of every rental.

`Item.pricePerDay` is currently doing double duty: it is both *what the renter
pays* and *what the owner receives*, because they were the same number.

---

## 3. Two decisions needed before implementation

### 3.1 ~~Per-day or per-rental?~~ **RESOLVED 2026-09-06: per RENTAL, flat.**
A 4-day rental is ₱1,600 + ₱20 = **₱1,620**, not ₱1,680. The fee is charged once
regardless of duration. This is a booking fee, not a daily markup.

### 3.2 What happens to existing listings? — **someone loses money either way**
`pricePerDay` today means "what the renter pays". Introducing the split forces a
choice for the 3 existing items:

- **Treat the stored value as the owner's rate** → every listing's price rises
  by the fee. Renters pay more than the price they were shown.
- **Treat it as the listed price and derive the owner's rate downward** →
  owners silently start receiving ₱380 where they expected ₱400.

Neither is safe to pick silently. Recommendation: **treat stored values as the
owner's rate** (owners keep what they expected), and make the change visible in
the listing UI, since no rental has completed yet and the blast radius is 3
items.

---

## 4. Data model

```prisma
model Item {
  pricePerDay  Float   // OWNER'S rate — what the lister receives. Unchanged
                       // name, CHANGED meaning: see §3.2.
  platformFee  Float?  // Per-item flat override. NULL = use the global default.
}
```

Global default lives alongside the existing late-fee reference table (Settings /
`KioskConfig`), not hardcoded:

```
PLATFORM_FEE_DEFAULT = 20.00   // PHP, flat, ONCE PER RENTAL (not per day)
```

**Derive totals, never store them.** Two stored numbers that must agree will
drift; D-17 is this project's live example. Two helpers, used everywhere:

```ts
platformFeeFor(item)        = item.platformFee ?? PLATFORM_FEE_DEFAULT   // flat
rentalTotal(item, days)     = item.pricePerDay * days + platformFeeFor(item)
```

**There is no such thing as a "listed price per day" any more.** Because the fee
is flat, a per-day figure that includes it is only correct for a one-day rental.
Do not invent one — see §7.

## 5. Settlement change

`rentalSettlementService.ts` §2 (owner payout), currently
`amount: rentalPaymentTxn.amount`:

```ts
const fee         = platformFeeFor(item);            // flat, NOT × days
const ownerPayout = rentalPaymentTxn.amount - fee;   // clamp at >= 0
```

- `OWNER_PAYOUT` transaction records **`ownerPayout`**, not the gross
- A **new `PLATFORM_FEE` transaction row** records the platform's share, so
  revenue is a queryable ledger fact rather than something re-derived in a
  report. A-5's revenue reporting reads this row
- The deposit is **never** part of the fee — it is the renter's money held in
  escrow and refunded in full, net only of damage/late fees

**Fix D-26 at the same time.** That branch already loses an owner's earnings
silently when `payoutReady && !PAYMONGO_SECRET_KEY`; it is the same function and
should write a `PENDING` row in every path.

## 6. Admin rate editing — the user's explicit request

**New admin page (or a section on the existing Settings page):**

- **Global default fee**, editable, with the current value and its effective date
- **Per-item table** — every item, with: owner's rate, effective fee
  (own or inherited), computed listed price, and an inline editable fee
- **Bulk edit** — select N items, set one fee. With 4 lockers the catalogue is
  small, but "apply to all" is the request and one-by-one does not scale past a
  demo
- **Reset to default** per item (clears the override back to NULL)
- **Every change writes an `AuditLog` row** — `recordAudit` already exists and
  is used for every other admin action. Changing what students are charged is
  exactly the class of action that needs a who/when/what trail
- **Role:** `requireAdmin`, not `requireStaff`. A Reviewer should not be able to
  change pricing

**Template row** (`TEMPLATE-LINKS.md`, Surface 2): Mantine DataTable with inline
editing — the same pattern as the existing items table, so it inherits its
density and filter behaviour rather than inventing a new one.

## 7. What the renter sees — copy, screen by screen

A flat per-rental fee **cannot be folded into a per-day price**. ₱420/day is only
true for a one-day rental; at 4 days it would imply ₱1,680 when the real total is
₱1,620. So the fee has to be **shown as its own line** — which is the honest
option anyway, and avoids the surprise-at-checkout problem the trust copy exists
to prevent.

### Item browse card
```
₱400 /day
+₱20 service fee per rental · ₱50 deposit, refunded
```
The daily rate stays the headline (it is what people compare on). The fee is
stated up front, in the same breath, so it is never a surprise later.

### Item detail — "What it costs"
```
WHAT IT COSTS
  Daily rate                              ₱400
  Service fee            one-time, per rental  ₱20
  Security deposit             refundable      ₱50

  A 3-day rental costs ₱1,250 up front —
  ₱1,200 rental + ₱20 service fee + ₱50 deposit.
  You get the ₱50 back after the return check.
```
The worked example is the important part: it is the first place a renter can see
how the three numbers combine, and it removes the arithmetic from their head.

### Checkout — the full breakdown, no rounding surprises
```
COST BREAKDOWN
  Rental        ₱400 × 4 days           ₱1,600.00
  Service fee   one-time                   ₱20.00
  ────────────────────────────────────────────────
  Subtotal                              ₱1,620.00
  Security deposit  refunded after return  ₱50.00
  ════════════════════════════════════════════════
  Pay now                               ₱1,670.00

  ₱50 of this comes back to you once the item passes
  its return check. You are charged ₱1,620.
```
Two figures a renter actually needs and currently cannot get: **what leaves my
account today** (₱1,670) and **what this actually costs me** (₱1,620). Show both.

The existing checkout screen already has a `COST BREAKDOWN` block with Rental /
Security deposit / Pay now rows — this adds the service-fee line and the
"comes back to you" sentence rather than restructuring it.

### Rental detail — after payment
The progress timeline's "Requested → Paid" step should state what was actually
charged and what is coming back:
```
Paid ₱1,670 · ₱50 deposit refunded after the return check
```

### Owner-facing — create listing
The owner is the one for whom the split is decision-relevant, so state it plainly
where they set the price:
```
You set ₱400/day. You receive ₱400/day.
EngiRent adds a ₱20 service fee per rental, paid by the renter — it does not
come out of your earnings.
```
**That last clause matters.** Without it an owner reasonably assumes the fee is
deducted from their ₱400.

## 8. The ₱10 transfer fee eats half of every rental — batching is not optional

Because the fee is **flat per rental**, platform revenue does not grow with
duration, but the ₱10 PayMongo transfer fee is charged per payout regardless:

| Rental length | Platform fee | Less ₱10 transfer | Platform nets |
|---|---|---|---|
| 1 day | ₱20 | −₱10 | **₱10** |
| 4 days | ₱20 | −₱10 | **₱10** |
| 7 days | ₱20 | −₱10 | **₱10** |

**Paying each owner individually costs the platform 50% of its revenue, forever,
at every duration.** Under the earlier per-day assumption longer rentals absorbed
the fee; they no longer do.

Three levers:
1. **Batch payouts** — up to 2,500 per transfer, so one ₱10 fee covers many
   rentals. A weekly run also uses the one free transfer per week, taking the
   effective cost toward **₱0**. This is the intended design, not an
   optimisation.
2. **MANUAL mode** (`PAYMENTS-AND-PAYOUTS-REVAMP.md` §2) — admin sends via GCash
   personally. No PayMongo transfer fee at all. Viable at 4-locker volume and
   works today, without Disbursements enabled.
3. **Raise the fee** — a decision, not an engineering matter, but the numbers
   above should inform it.

Also: **bank payouts have an ₱80 minimum**; wallet-to-wallet is ₱1. A single
₱400 payout clears that, but it is another reason batching is the default shape.

## 9. Payouts cannot be instant — the ledger must tolerate a wait

Money from a checkout is **not immediately disbursable**. PayMongo clears funds
before they are spendable: cards **3 banking days**, e-wallets (GCash, GrabPay,
Maya, ShopeePay) **2**, bank transfer/QR Ph **1** — banking days only, and
anything after 5pm rolls to the next business day. T+1 clearing is available on
request subject to account standing.

**Consequence for settlement:** firing a disbursement the moment a rental
completes will fail for insufficient balance whenever the renter's payment has
not cleared. The settlement path must therefore write a **PENDING
`OWNER_PAYOUT`** row and let a separate worker (or the weekly batch above) send
it once funds are available — which is exactly the row shape D-26 already needs
for its silent-loss branch. Build both together.

## 10. Testing

Per `API-TEST-PLAN.md`'s five-case rule, plus:
- A payout attempted before funds clear is queued as PENDING, not lost or double-sent
- Batched settlement pays N rentals with one transfer fee, and the ledger still balances per rental
- Fee applied **once per rental**, not per day — a 4-day rental totals ₱1,620, not ₱1,680
- `rentalTotal()` is the only place totals are computed; no screen recomputes them locally
- Per-item override beats the global default; NULL inherits
- `ownerPayout + platformFee === rentalPaymentTxn.amount`, exactly, no rounding drift
- Deposit is untouched by the fee
- A fee larger than the rental total clamps the payout at zero rather than going negative
- Non-admin (Reviewer) cannot edit rates → 403
