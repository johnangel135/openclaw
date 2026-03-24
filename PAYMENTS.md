# Payments (Stripe) Integration

This project now includes a complete, secure Stripe subscription slice with idempotent webhook processing and persisted subscription state.

## Implemented

- Pricing/readiness endpoints
- Authenticated checkout session creation (`stub` and `live`)
- Stripe signature verification for webhooks
- Idempotent webhook event recording (`payment_events`)
- Subscription state upsert (`user_subscriptions`)
- Authenticated entitlement endpoint
- Authenticated billing portal session endpoint (`stub` and `live`)

## Endpoints

- `GET /api/payments/readiness`
- `GET /api/payments/plans`
- `POST /api/user/payments/checkout-session`
- `POST /api/payments/webhook/stripe`
- `GET /api/user/subscription`
- `POST /api/user/payments/billing-portal`

## Database tables

- `user_subscriptions`
  - `user_id`, `provider`, `status`
  - `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`
  - `current_period_end`, `cancel_at_period_end`
  - `metadata` (JSONB)
  - `created_at`, `updated_at`
  - PK: `(user_id, provider)`

- `payment_events`
  - `provider`, `event_id`, `event_type`
  - `payload_hash`, `payload` (minimal JSONB)
  - `processed_at`, `created_at`
  - Unique idempotency key: `(provider, event_id)`

## Stripe webhook events handled

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- Unknown events are acknowledged with a safe no-op.

## Required env vars

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
STRIPE_BILLING_PORTAL_RETURN_URL=https://your-app.example.com/billing
STRIPE_CHECKOUT_MODE=stub
STRIPE_WEBHOOK_TOLERANCE_SECONDS=300
```

## Security notes

- Signature verification uses HMAC SHA-256 + timing-safe compare.
- Old webhook signatures are rejected (`STRIPE_WEBHOOK_TOLERANCE_SECONDS`).
- Secrets are never returned in API responses.
- Auth user mutation endpoints enforce same-origin checks.
- Billing portal returns explicit error codes for missing customer/config.
