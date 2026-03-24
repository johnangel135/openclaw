# Payments Readiness Baseline (Stripe)

This project includes a **payment-readiness baseline** that is safe-by-default and does not execute live billing.

## What is implemented

- Pricing plan model scaffold (`src/pricing-plans.js`)
- Payment readiness inspector (`GET /api/payments/readiness`)
- Public plan listing (`GET /api/payments/plans`)
- Authenticated checkout session stub (`POST /api/user/payments/checkout-session`)
- Stripe webhook signature verification skeleton (`POST /api/payments/webhook/stripe`)

## Security and threat considerations

- **No secret exposure:** API responses never include Stripe secret or webhook secret values.
- **Graceful disabled mode:** if required Stripe env vars are missing, checkout returns `503 payments_not_configured`.
- **Signed webhook verification:** verifies `Stripe-Signature` using HMAC SHA-256 and a timestamp tolerance window.
- **Replay resistance:** old signatures are rejected via `STRIPE_WEBHOOK_TOLERANCE_SECONDS`.
- **Timing-safe compare:** signature matching uses `crypto.timingSafeEqual`.
- **CSRF mitigation:** checkout session route requires same-origin headers and a valid user session.
- **Stub mode:** checkout route intentionally returns a "not submitted" stub until real Stripe API calls are wired in.

## Required environment variables

```env
STRIPE_SECRET_KEY=sk_test_or_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
```

Optional:

```env
STRIPE_SUCCESS_URL=https://your-app.example.com/billing/success
STRIPE_CANCEL_URL=https://your-app.example.com/billing/cancel
STRIPE_WEBHOOK_TOLERANCE_SECONDS=300
```

## Next integration step (intentionally not included)

Inside `buildCheckoutSessionStub`, replace the stub with Stripe SDK session creation and return a real checkout URL/session id.

Keep webhook handling idempotent and persist processed event IDs before state changes.
