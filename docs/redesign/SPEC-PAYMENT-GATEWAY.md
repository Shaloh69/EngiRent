# SPEC — PayMongo payment gateway on Render (planned 2026-10-19, NOT built)

User request (2026-10-19): *"For paymongo i want the paymongo API to be separate and be hosted in render free tier to survive restarts. Make sure that this works as intended. Add proper messaging to the app or etc: payment approval takes several minutes, server is waking up etc. Also add a separate process for the sandbox mode and real production mode for me. Also give me the full instruction on how to host this."*

Status: **plan only.** No code exists yet. Section 7 is the phase table (G2); section 8 is the hosting guide.

---

## 1. Why, in one paragraph

Today the main API (on the server PC, behind a Cloudflare *quick* tunnel) talks to PayMongo itself. Its address changes on every restart, so the PayMongo webhook can never be pointed at it, and the registered webhook still targets the dead `engirent-api.onrender.com`. Payments only confirm because the API polls PayMongo every 5 s (`paymentPoller.ts`). A small service on Render gets a **permanent address** (`https://<name>.onrender.com`). That fixes the webhook, keeps working when the server PC restarts, and moves the PayMongo secret key off the server PC.

## 2. Facts the design depends on (checked 2026-10-19)

| Fact | Source | Consequence |
|---|---|---|
| A free Render web service sleeps after **15 min** with no requests. Waking takes **about 1 minute**. | render.com/docs/free | The first payment after a quiet period waits ~1 min. The app must say so (section 5). |
| **750 free hours per workspace per month.** A sleeping service uses none. | render.com/docs/free | One service awake 24/7 uses ~744 h. **Two services cannot both stay awake**, so only the live one may be kept warm. |
| The disk is **wiped** on every restart, redeploy or sleep. **Render may restart a free service at any time.** | render.com/docs/free | The gateway must be **stateless**. Every payment record stays in the main database on the server PC. |
| Free Postgres **expires after 30 days**. | render.com/docs/free | Don't use it. Nothing on Render stores data. |
| PayMongo treats a webhook as failed if there is no 2xx reply within **30 s**. It **retries up to 12 times** over ~2¼ h with backoff. | developers.paymongo.com, webhook retry logic | A webhook that wakes a sleeping gateway fails once; a later retry reaches it awake. That alone is too slow, so the poller stays as the main path (section 4). |
| After **3 consecutive events** use up all their retries, PayMongo **disables the webhook** until it is re-enabled by hand. | developers.paymongo.com | The gateway returns 200 for every correctly signed event, even when it can't reach the main API. A dead server PC must never get the webhook disabled. |
| Every webhook carries a `Paymongo-Signature` header (HMAC-SHA256 with the webhook's own secret). Test-mode and live-mode webhooks have **different secrets**. | developers.paymongo.com | Each gateway verifies with the secret of its own mode. |

Re-derived from the repo (not from memory):

- **Calls that need the PayMongo secret key, all moving to the gateway:**
  - checkout create, retrieve and expire (`paymongoService.ts`, `disputeKioskService.ts`, `paymentPoller.ts`);
  - refunds (`paymentController.createRefund`, used by `rentalSettlementService.ts` and `concernService.ts`);
  - transfers, i.e. payouts and receiving institutions (`payoutService.ts`);
  - the key check (`adminController.ts:1735`);
  - webhook verification (`paymentController.ts:106`).
- The confirmation path `markTransactionPaid` is already idempotent, so the webhook and the poller can both fire safely.
- **Recorded, not re-verified today:** `PAYMENT_MODE=MANUAL` is the user's kill switch "until a LIVE key is installed" (PROGRESS 2026-10-11). Reading the live `.env` on 2026-10-19 returned nothing, so this is unconfirmed.

## 3. The design

```
 Phone app / kiosk ──► Main API (server PC, quick tunnel; DB = source of truth)
                          │  every PayMongo action, with a shared token
                          ▼
                   Payment gateway on Render  ◄── PayMongo webhook (permanent URL)
                   (stateless; holds the key)  ──► forwards a confirmed payment to
                          │                        the main API's CURRENT URL (read
                          ▼                        from the gist the app already uses)
                       PayMongo
```

### 3.1 Two gateways: one per mode

| | Sandbox gateway | Production gateway |
|---|---|---|
| Render service | `engirent-pay-sandbox` | `engirent-pay-live` |
| Keys | `sk_test_…` / `pk_test_…` | `sk_live_…` / `pk_live_…` (a **rotated** live key, never the one pasted in chat on 2026-09-06) |
| PayMongo webhook | test-mode webhook → `https://engirent-pay-sandbox.onrender.com/webhook` | live-mode webhook → `https://engirent-pay-live.onrender.com/webhook` |
| Startup check | **refuses to start** unless the key starts with `sk_test_` | **refuses to start** unless the key starts with `sk_live_` *and* `ALLOW_LIVE=yes` |
| Kept awake? | No: it sleeps, and the first test payment waits a minute | Optional, your choice (section 9, D1) |
| Money | Simulated; test cards / test GCash | Real |

Each gateway reports its own mode at `GET /health`, e.g. `{ "mode": "sandbox", "keyMode": "test", "version": … }`. The main API compares that with what it expects and **refuses to create a payment if they disagree**. Pointing the live app at the sandbox gateway, or the reverse, therefore fails closed with a clear admin error. Payments are never silently mixed.

### 3.2 Switching modes: one setting on the main API

| Main API `.env` | Effect |
|---|---|
| `PAYMENT_MODE=MANUAL` | Today's kill switch: no PayMongo at all, manual GCash with admin confirmation. Unchanged. |
| `PAYMENT_MODE=PAYMONGO` + `PAYMENT_GATEWAY=sandbox` | Uses `PAYMENT_GATEWAY_SANDBOX_URL` + `PAYMENT_GATEWAY_SANDBOX_TOKEN`. App, kiosk and admin show **TEST MODE: no real money moves** on every payment screen. |
| `PAYMENT_MODE=PAYMONGO` + `PAYMENT_GATEWAY=live` | Uses `PAYMENT_GATEWAY_LIVE_URL` + `PAYMENT_GATEWAY_LIVE_TOKEN`. No test banner. |

Each transaction row records the mode it was created in (a new `paymentEnv` column, `sandbox` or `live`). The poller asks **that** mode's gateway. A sandbox checkout made before a switch to live keeps resolving against the sandbox, and a test payment can never be confirmed as real money.

### 3.3 Gateway endpoints (all except `/health` and `/webhook` need `Authorization: Bearer <gateway token>`)

| Endpoint | Does |
|---|---|
| `GET /health` | `{mode, keyMode, uptimeS, version}`. No secrets. Used to wake it and to check its mode. |
| `POST /checkouts` | Create a checkout session. Returns `{checkoutUrl, checkoutId}`. |
| `GET /checkouts/:id` | `{state: paid / expired / open, paymentId, referenceNo}`, the same shape as `retrieveCheckoutSession` today. |
| `POST /checkouts/:id/expire` | Close a checkout. |
| `POST /refunds` | Refund `{paymentId, amount, reason}`. |
| `GET /transfers/institutions`, `POST /transfers` | Payouts. Blocked until PayMongo enables Disbursements on the account (still not enabled). |
| `POST /webhook` | Verifies `Paymongo-Signature` with this mode's webhook secret, answers **200 immediately**, then forwards `{checkoutId, paymentId, referenceNo, type}` to `<current main API>/api/v1/payments/gateway-event`, signed with the gateway token. An invalid signature gets a 400 and nothing is forwarded. |

Every input is validated. Amounts are taken from the main API's request; the gateway never invents an amount. It logs payment IDs, never card data.

## 4. How it survives restarts

| Restart | What happens | Why nothing is lost |
|---|---|---|
| **Server PC / main API restarts** | Webhooks still reach the gateway on its fixed address. A forward fails while the API is down. | The main database never lost the pending transaction. When the API comes back, its **poller asks the gateway** about every pending checkout and confirms the paid ones. The gateway's 200 keeps PayMongo from disabling the webhook. |
| **Tunnel rotates** (new API address) | The gateway reads the main API's current address from the **gist** (`engirent-endpoint.json`, already updated on every rehost), cached for 5 min and re-read when a forward fails. | Same as above: the poller is the backstop. |
| **Gateway sleeps** | The next request takes about a minute. | The main API **wakes it ahead of time** whenever a payment is coming: the app opens the pay screen, a kiosk session starts a dispute fee, or a rental is approved. By the time the student taps Pay it's usually awake. |
| **Render restarts the gateway** at random | It boots in ~1 min with an empty memory. | It holds nothing: every request carries everything it needs. |
| **PayMongo can't reach the gateway** | PayMongo retries for ~2¼ h. | The poller confirms anyway; the webhook only makes it faster. |

**Confirmation time, as it will be measured and stated:** usually seconds (webhook, or the 5 s poll). If the gateway was asleep, add about a minute. The worst case is the 5-minute slow poll for checkouts older than 2 h. Nothing in this plan is claimed until it has been timed (P8).

## 5. Messages the student and the admin will see

Wording follows the house style (plain, says what happens next, never blames the student). Each state comes from a real server state, not a timer guess.

| Moment | App / kiosk says |
|---|---|
| The gateway is waking (the health check didn't answer within 3 s) | **"Connecting to the payment service… This can take up to a minute when it hasn't been used for a while. Please keep this screen open."** A progress indicator with no fake percentage, plus a "still connecting" line after 30 s. |
| It didn't wake within 90 s | **"The payment service isn't answering right now. Nothing was charged. Try again in a minute, or pay by GCash and an admin will confirm it."** (Offers the manual fallback that exists today.) |
| Checkout open, waiting for PayMongo | **"Complete the payment in the PayMongo window."** |
| Returned from PayMongo, not yet confirmed | **"Payment received by PayMongo. Confirming… This usually takes a few seconds, sometimes a few minutes. You can leave this screen; we'll notify you."** |
| Still unconfirmed after 3 min | **"Still confirming. Your payment is safe: if PayMongo took it, it will show here within a few minutes. Don't pay twice."** |
| Confirmed | **"Payment confirmed."** A push notification as today. |
| Sandbox mode | A fixed amber strip on every payment screen: **"TEST MODE: no real money moves. Use PayMongo test cards."** |
| Kiosk dispute fee, gateway waking | The kiosk says the same "Connecting… up to a minute" line, and its 120 s session clock accounts for the wake. |

The **admin console** gets a "Payment service" card:

- mode (sandbox or live) and whether it is awake;
- the time since the last webhook;
- the time since the last successful forward;
- the number of transactions pending longer than 10 minutes.

## 6. Security

- The PayMongo secret key lives **only** in Render's environment settings for that service. It is **not** in the repo (the repo is public), not in `render.yaml` (`sync: false`) and not on the server PC.
- The main API and the gateway share one random 32-byte token per mode. Webhook forwards are HMAC-signed with it and carry a timestamp; anything older than 5 minutes is refused, so a replay can't confirm a payment twice. `markTransactionPaid` is also idempotent.
- **The main API never trusts a forwarded "paid" on its own.** On a gateway event it asks the gateway `GET /checkouts/:id` and only marks the payment paid if PayMongo says paid, for an amount equal to the transaction's. The webhook speeds things up but never decides anything on its own.
- Production startup interlock: `sk_live_` + `ALLOW_LIVE=yes`, and the main API refuses `PAYMENT_GATEWAY=live` while `PAYMENT_MODE=MANUAL`. **Before going live: confirm the live key was rotated** (the old one was exposed on 2026-09-06).

## 7. Phase table (G2): one row at a time, each verified before the next

| # | Section | Where | Done when |
|---|---|---|---|
| P1 | Gateway service (Express + TypeScript): `/health`, checkouts, refunds, webhook verify + forward, mode interlocks, token auth | new `server/payment_gateway/` + `render.yaml` | unit tests incl. bad signature, wrong mode, missing token, replayed forward; each guard **mutation-checked** (the user's 2026-10-15 rule) |
| P2 | Main API: `paymongoService` calls the gateway instead of PayMongo; `paymentEnv` column; poller asks the right gateway; `POST /payments/gateway-event` (verify, then re-check); pre-wake calls | `server/node_server` | Node tests; the existing payment e2e suite green against the **sandbox gateway running locally** |
| P3 | Deploy `engirent-pay-sandbox` on Render; register the test-mode webhook | Render + PayMongo dashboard | a test checkout paid with a PayMongo test card confirms through **the webhook** (poller disabled for the test), and again through **the poller** (webhook disabled) |
| P4 | Restart drills on sandbox: restart the main API mid-payment; let the gateway sleep then pay; rotate the tunnel | live sandbox | each drill confirms the payment; timings written down |
| P5 | App messages (section 5) + TEST MODE strip; kiosk wording; admin "Payment service" card | Flutter, kiosk UI, admin | every state rendered and looked at; the sleeping-gateway state seen on a phone by the user |
| P6 | Release (APK, website + changelog, AppRelease + LATEST_APP_VERSION) | release | four places verified live |
| P7 | Production gateway `engirent-pay-live` deployed with a **rotated** live key; live webhook registered; still `PAYMENT_GATEWAY=sandbox` | Render + PayMongo | `/health` says live; a ₱1 checkout created and **expired unpaid** (no real charge) |
| P8 | Go live: `PAYMENT_MODE=PAYMONGO`, `PAYMENT_GATEWAY=live`, after the user's explicit yes | main API `.env` | one real small payment by the user, confirmed and refunded; confirmation time measured |

## 8. Hosting guide (what you will do, step by step)

Everything here uses the free plan. You need the GitHub account that owns the repo, a PayMongo account, and about 30 minutes. Steps marked **(after P1-P2)** need the code from phases P1-P2 first.

### 8.1 Create the Render account
1. Go to **render.com → Get Started**, and sign up **with GitHub** (the same account that owns `EngiRent`).
2. When Render asks for repository access, choose **Only select repositories → EngiRent**.
3. Don't add a payment method. Without one, Render can never bill you: if a limit is reached, the free service is paused until the next month instead.

### 8.2 Get your PayMongo keys
1. Log in to **dashboard.paymongo.com → Developers → API keys**.
2. **Test mode** (toggle at the top): copy the `pk_test_…` and `sk_test_…` keys.
3. **Live mode** (only when going live, P7): **roll / regenerate the secret key first** (the old live key was exposed on 2026-09-06), then copy the new `pk_live_…` and `sk_live_…` keys.
4. Never paste a key into a chat, an issue, a commit or a screenshot. Paste keys only into Render's environment page.

### 8.3 Create the sandbox gateway (after P1-P2)
1. Render dashboard → **New → Blueprint** → pick the `EngiRent` repo. Render reads `render.yaml` and proposes **two** services: `engirent-pay-sandbox` and `engirent-pay-live`. You can create both now (a sleeping service costs nothing) or untick live until P7.
2. Both use **Plan: Free**, **Root directory** `server/payment_gateway`, **Build** `npm ci && npm run build`, **Start** `npm start`, and **Health check path** `/health`. The blueprint already contains these.
3. For `engirent-pay-sandbox`, Render asks for the values marked secret. Fill in:

   | Key | Value |
   |---|---|
   | `PAYMENT_ENV` | `sandbox` (the blueprint fills it in) |
   | `PAYMONGO_SECRET_KEY` | your `sk_test_…` |
   | `PAYMONGO_WEBHOOK_SECRET` | leave empty for now; it comes from 8.4 |
   | `GATEWAY_TOKEN` | a long random string. Generate one on the server PC with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and keep it for 8.5 |
   | `ENDPOINT_GIST_URL` | the raw URL of the `engirent-endpoint.json` gist (the blueprint fills it in) |

4. Click **Apply**. Wait for **Live**, then open `https://engirent-pay-sandbox.onrender.com/health`. It should say `"mode":"sandbox","keyMode":"test"`.

### 8.4 Register the sandbox webhook in PayMongo
1. PayMongo dashboard, **Test mode** → **Developers → Webhooks → Create webhook**.
2. URL: `https://engirent-pay-sandbox.onrender.com/webhook`
3. Events: `checkout_session.payment.paid`, `payment.paid`, `payment.failed`.
4. Save, then copy the webhook's **signing secret** (`whsk_…`).
5. Render → `engirent-pay-sandbox` → **Environment** → set `PAYMONGO_WEBHOOK_SECRET` to it → **Save changes**. Render redeploys by itself.
6. **Delete or disable** the old webhook that points at `engirent-api.onrender.com`. It is dead, and its failures count toward PayMongo disabling webhooks.

### 8.5 Point the main API at the sandbox gateway
On the server PC, edit `D:\ENG\EngiRent\server\node_server\.env`. Make a backup copy first, and save as UTF-8 **without** BOM.

```
PAYMENT_MODE=PAYMONGO
PAYMENT_GATEWAY=sandbox
PAYMENT_GATEWAY_SANDBOX_URL=https://engirent-pay-sandbox.onrender.com
PAYMENT_GATEWAY_SANDBOX_TOKEN=<the same GATEWAY_TOKEN as on Render>
```

Then:
1. Remove `PAYMONGO_SECRET_KEY`, `PAYMONGO_PUBLIC_KEY` and `PAYMONGO_WEBHOOK_SECRET` from this file. They now live only on Render.
2. Restart the API (I'll do this, after the usual no-kiosk-flow check).
3. Admin console → **Payment service** card should show *Sandbox · awake*.

### 8.6 Test the sandbox (what P3-P4 check)
1. In the app, book an item and pay. You'll see the amber **TEST MODE** strip.
2. Pay with a PayMongo **test card**: `4343 4343 4343 4345`, any future expiry, any CVC. You can also use the test GCash flow.
3. The payment should show as confirmed within seconds. Check the admin card's "last webhook" time.
4. **Sleep test:** wait 20 minutes without using it, then pay again. You should see *"Connecting to the payment service… up to a minute"*, then the checkout.
5. **Restart test:** start a payment, restart the main API while you're on the PayMongo page, finish paying. After the API is back, the payment should confirm by itself within a minute.

### 8.7 Production (P7-P8, only with your explicit go-ahead)
1. Rotate the live secret key (8.2 step 3).
2. Render → `engirent-pay-live` → Environment:

   | Key | Value |
   |---|---|
   | `PAYMONGO_SECRET_KEY` | `sk_live_…` |
   | `ALLOW_LIVE` | `yes` |
   | `GATEWAY_TOKEN` | a **different** random string from sandbox |

3. Check `https://engirent-pay-live.onrender.com/health`. It should say `"mode":"live","keyMode":"live"`.
4. PayMongo dashboard in **Live mode** → create the webhook to `https://engirent-pay-live.onrender.com/webhook` with the same events, and put its secret into `PAYMONGO_WEBHOOK_SECRET` on the live service.
5. Main API `.env`: add `PAYMENT_GATEWAY_LIVE_URL` and `PAYMENT_GATEWAY_LIVE_TOKEN`, then change `PAYMENT_GATEWAY=live`. Restart.
6. Make one small real payment yourself, see it confirm, then refund it from the admin console.
7. **To go back to test at any time:** set `PAYMENT_GATEWAY=sandbox` and restart. **Emergency stop:** set `PAYMENT_MODE=MANUAL` and restart. Nothing on Render needs to change for either.

### 8.8 Keeping the live gateway awake (optional, see D1)
If you choose it, add a free uptime monitor (e.g. UptimeRobot) that requests `https://engirent-pay-live.onrender.com/health` every 10 minutes. It uses about 744 of the 750 free hours, so **don't** do this for the sandbox as well. Render's docs don't forbid it; they only say that inbound traffic keeps the service awake.

## 9. Decisions (ruled by the user 2026-10-19: "yes to all")

- **D1 — Keep the live gateway awake: YES.** Uptime monitor on `engirent-pay-live` `/health` every 10 min, once live (8.8). The sandbox is never kept awake.
- **D2 — Kiosk fallback: YES.** A kiosk dispute fee waits up to 90 s for a waking gateway, then offers GCash with admin confirmation.
- **D3 — Live key rotated: YES** (user, 2026-10-19). The new live key goes ONLY into Render's environment for `engirent-pay-live`, never into the repo, the chat or the server PC.
- **D4 — Disbursements: CORRECTED 2026-10-19.** The September finding "Disbursements not enabled (404)" came from **our own wrong URL**: `payoutService.ts` calls `GET /v2/transfers/receiving_institutions`, which does not exist. The documented call is `GET /v1/wallets/receiving_institutions?provider=instapay|pesonet`, and with the TEST key it returns 94 InstaPay and 124 PESONet banks. Creating a transfer is `POST /v2/batch_transfers` and **requires** `source_account {number, name, bic: PAEYPHM2XXX}` (our code makes it optional). In TEST mode the account has **no wallet** (`GET /v1/wallets` gives `data: null`), so a test transfer cannot be sent yet. To check: PayMongo dashboard, **Wallet**, in test and in live mode. The gateway's `/health` will report `walletReady: true/false`, so this is visible without guessing. The gateway (P1) uses the correct paths and a required source wallet (`PAYMONGO_SOURCE_ACCOUNT_NUMBER`/`_NAME` on Render).

Other rulings the same day: `MIN_APP_VERSION=1.16.0` (forced update, set and verified live); the 306 captured face photos copied to the gitignored `_live` folder (all 306 verified by name and size).

Sources: [Render free tier](https://render.com/docs/free), [PayMongo webhook retry logic](https://developers.paymongo.com/docs/webhook-retry-logic), [PayMongo retry a webhook delivery](https://developers.paymongo.com/docs/retry-a-webhook-delivery), [PayMongo webhook key concepts](https://docs.paymongo.com/docs/developer-tools-webhooks-key-concepts), [PayMongo test cards](https://developers.paymongo.com/docs/payment-acceptance-testing), [PayMongo webhooks / events](https://developers.paymongo.com/docs/webhooks).
