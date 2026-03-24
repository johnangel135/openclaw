-- Payments and subscription persistence

CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, provider)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_subscription_id
  ON user_subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_provider_status
  ON user_subscriptions (provider, status);

CREATE TABLE IF NOT EXISTS payment_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_events_provider_created_at
  ON payment_events (provider, created_at DESC);
