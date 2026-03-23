CREATE TABLE IF NOT EXISTS model_pricing (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_cost_per_million_usd NUMERIC(14, 6) NOT NULL,
  output_cost_per_million_usd NUMERIC(14, 6) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, model)
);

CREATE TABLE IF NOT EXISTS llm_usage_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(14, 8) NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status_code INTEGER NOT NULL,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_events_created_at
  ON llm_usage_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_usage_events_provider_model_created_at
  ON llm_usage_events (provider, model, created_at DESC);

INSERT INTO model_pricing (provider, model, input_cost_per_million_usd, output_cost_per_million_usd)
VALUES
  ('openai', 'gpt-4o-mini', 0.15, 0.6),
  ('openai', 'gpt-4o', 2.5, 10.0),
  ('openai', 'gpt-5-mini', 0.25, 1.0),
  ('openai', 'gpt-5', 1.25, 5.0),
  ('anthropic', 'claude-3-5-haiku-latest', 1.0, 5.0),
  ('anthropic', 'claude-3-5-sonnet-latest', 3.0, 15.0),
  ('anthropic', 'claude-3-7-sonnet-latest', 3.0, 15.0),
  ('gemini', 'gemini-1.5-flash', 0.35, 0.53),
  ('gemini', 'gemini-1.5-pro', 1.25, 5.0),
  ('gemini', 'gemini-2.0-flash', 0.2, 0.8)
ON CONFLICT (provider, model) DO UPDATE SET
  input_cost_per_million_usd = EXCLUDED.input_cost_per_million_usd,
  output_cost_per_million_usd = EXCLUDED.output_cost_per_million_usd,
  updated_at = NOW();
