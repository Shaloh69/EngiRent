# EngiRent payment gateway

The only service that holds a PayMongo key. Stateless; one instance per mode
(`engirent-pay-sandbox`, `engirent-pay-live`) on Render's free tier, defined in
the repo-root `render.yaml`.

- Design, messages, phases and **the step-by-step hosting guide**:
  [`docs/redesign/SPEC-PAYMENT-GATEWAY.md`](../../docs/redesign/SPEC-PAYMENT-GATEWAY.md)
- `npm test` — 52 tests; every safety guard is mutation-checked (21/21).
- Run locally (sandbox): `PAYMENT_ENV=sandbox PAYMONGO_SECRET_KEY=sk_test_… GATEWAY_TOKEN=<32+ chars> MAIN_API_URL=https://… npm run build && npm start`

It refuses to start with the wrong kind of key for its mode, a live key without
`ALLOW_LIVE=yes`, or a short `GATEWAY_TOKEN`. Never commit a key: this repo is public.
