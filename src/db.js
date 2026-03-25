'use strict';

const crypto = require('crypto');
const { Pool } = require('pg');
const { DATABASE_URL, USAGE_REQUESTS_MAX_LIMIT, USAGE_RETENTION_DAYS } = require('./config');
const { getPgSslConfig } = require('./pg-ssl');

let pool;
let initialized = false;
let retentionTimer;

const SEEDED_MODEL_PRICING = [
  ['openai', 'gpt-4o-mini', 0.15, 0.6],
  ['openai', 'gpt-4o', 2.5, 10.0],
  ['openai', 'gpt-5-mini', 0.25, 1.0],
  ['openai', 'gpt-5', 1.25, 5.0],
  ['anthropic', 'claude-3-5-haiku-latest', 1.0, 5.0],
  ['anthropic', 'claude-3-5-sonnet-latest', 3.0, 15.0],
  ['anthropic', 'claude-3-7-sonnet-latest', 3.0, 15.0],
  ['gemini', 'gemini-1.5-flash', 0.35, 0.53],
  ['gemini', 'gemini-1.5-pro', 1.25, 5.0],
  ['gemini', 'gemini-2.0-flash', 0.2, 0.8],
];

function isDatabaseConfigured() {
  return Boolean(DATABASE_URL);
}

function getPool() {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is not configured');
  }

  if (pool) {
    return pool;
  }

  const ssl = getPgSslConfig(DATABASE_URL);

  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl,
  });

  return pool;
}

async function initDatabase() {
  if (!isDatabaseConfigured()) {
    return false;
  }

  if (initialized) {
    return true;
  }

  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS model_pricing (
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_cost_per_million_usd NUMERIC(14, 6) NOT NULL,
      output_cost_per_million_usd NUMERIC(14, 6) NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (provider, model)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS llm_usage_events (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      user_id TEXT,
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
    )
  `);

  await db.query('ALTER TABLE llm_usage_events ADD COLUMN IF NOT EXISTS user_id TEXT');
  await db.query('CREATE INDEX IF NOT EXISTS idx_llm_usage_events_created_at ON llm_usage_events (created_at DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_llm_usage_events_provider_model_created_at ON llm_usage_events (provider, model, created_at DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_llm_usage_events_user_created_at ON llm_usage_events (user_id, created_at DESC)');

  await db.query(`
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
    )
  `);
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_subscription_id ON user_subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL');
  await db.query('CREATE INDEX IF NOT EXISTS idx_user_subscriptions_provider_status ON user_subscriptions (provider, status)');

  await db.query(`
    CREATE TABLE IF NOT EXISTS stripe_usage_sync_runs (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      period_start TIMESTAMPTZ NOT NULL,
      period_end TIMESTAMPTZ NOT NULL,
      meter_type TEXT NOT NULL,
      quantity BIGINT NOT NULL DEFAULT 0,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS idx_stripe_usage_sync_runs_user_period ON stripe_usage_sync_runs (user_id, period_start, period_end)');

  await db.query(`
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
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS idx_payment_events_provider_created_at ON payment_events (provider, created_at DESC)');

  for (const [provider, model, inputPrice, outputPrice] of SEEDED_MODEL_PRICING) {
    await db.query(
      `
      INSERT INTO model_pricing (provider, model, input_cost_per_million_usd, output_cost_per_million_usd)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (provider, model)
      DO UPDATE SET
        input_cost_per_million_usd = EXCLUDED.input_cost_per_million_usd,
        output_cost_per_million_usd = EXCLUDED.output_cost_per_million_usd,
        updated_at = NOW()
      `,
      [provider, model, inputPrice, outputPrice],
    );
  }

  await purgeOldUsage(USAGE_RETENTION_DAYS);
  initialized = true;

  return true;
}

function toNumber(value) {
  if (value === null || value === undefined) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateEstimatedCost(inputTokens, outputTokens, pricingRow) {
  if (!pricingRow) {
    return 0;
  }

  const inputRate = toNumber(pricingRow.input_cost_per_million_usd);
  const outputRate = toNumber(pricingRow.output_cost_per_million_usd);

  const estimate = ((inputTokens * inputRate) + (outputTokens * outputRate)) / 1_000_000;
  return Number(estimate.toFixed(8));
}

async function getModelPricing(provider, model) {
  const db = getPool();
  const result = await db.query(
    `
    SELECT provider, model, input_cost_per_million_usd, output_cost_per_million_usd
    FROM model_pricing
    WHERE provider = $1 AND model = $2
    `,
    [provider, model],
  );

  if (result.rows.length > 0) {
    return result.rows[0];
  }

  // Fallback to provider-level default if exact model is missing.
  const fallback = await db.query(
    `
    SELECT provider, model, input_cost_per_million_usd, output_cost_per_million_usd
    FROM model_pricing
    WHERE provider = $1
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [provider],
  );

  return fallback.rows[0] || null;
}

async function estimateCostUsd(provider, model, inputTokens, outputTokens) {
  if (!isDatabaseConfigured()) {
    return 0;
  }
  const pricingRow = await getModelPricing(provider, model);
  return calculateEstimatedCost(inputTokens, outputTokens, pricingRow);
}

async function logUsageEvent(event) {
  const db = getPool();
  await db.query(
    `
    INSERT INTO llm_usage_events (
      user_id,
      provider,
      model,
      endpoint,
      input_tokens,
      output_tokens,
      total_tokens,
      estimated_cost_usd,
      latency_ms,
      status_code,
      error_code
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `,
    [
      event.user_id || null,
      event.provider,
      event.model,
      event.endpoint,
      event.input_tokens,
      event.output_tokens,
      event.total_tokens,
      event.estimated_cost_usd,
      event.latency_ms,
      event.status_code,
      event.error_code || null,
    ],
  );
}

function buildUserFilter(userId, startIndex = 3) {
  if (!userId) {
    return { clause: '', values: [] };
  }
  return {
    clause: ` AND user_id = $${startIndex}`,
    values: [userId],
  };
}

function normalizeRange(from, to) {
  const now = new Date();
  const parsedTo = to ? new Date(to) : now;
  const parsedFrom = from ? new Date(from) : new Date(parsedTo.getTime() - (24 * 60 * 60 * 1000));

  const safeTo = Number.isNaN(parsedTo.getTime()) ? now : parsedTo;
  const safeFrom = Number.isNaN(parsedFrom.getTime()) ? new Date(safeTo.getTime() - (24 * 60 * 60 * 1000)) : parsedFrom;

  if (safeFrom > safeTo) {
    return { from: new Date(safeTo.getTime() - (24 * 60 * 60 * 1000)), to: safeTo };
  }

  return { from: safeFrom, to: safeTo };
}

async function getUsageSummary(from, to, userId = null) {
  const db = getPool();
  const range = normalizeRange(from, to);
  const filter = buildUserFilter(userId, 3);
  const result = await db.query(
    `
    SELECT
      COUNT(*)::int AS request_count,
      COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,
      COALESCE(SUM(output_tokens),0)::bigint AS output_tokens,
      COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,
      COALESCE(SUM(estimated_cost_usd),0)::numeric AS estimated_cost_usd
    FROM llm_usage_events
    WHERE created_at >= $1 AND created_at <= $2${filter.clause}
    `,
    [range.from.toISOString(), range.to.toISOString(), ...filter.values],
  );

  const row = result.rows[0];
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    request_count: toNumber(row.request_count),
    input_tokens: toNumber(row.input_tokens),
    output_tokens: toNumber(row.output_tokens),
    total_tokens: toNumber(row.total_tokens),
    estimated_cost_usd: Number(toNumber(row.estimated_cost_usd).toFixed(8)),
  };
}

async function getUsageTrend(from, to, bucket, userId = null) {
  const db = getPool();
  const safeBucket = bucket === 'day' ? 'day' : 'hour';
  const range = normalizeRange(from, to);
  const filter = buildUserFilter(userId, 4);

  const result = await db.query(
    `
    SELECT
      date_trunc($3, created_at) AS bucket_start,
      COUNT(*)::int AS request_count,
      COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,
      COALESCE(SUM(estimated_cost_usd),0)::numeric AS estimated_cost_usd
    FROM llm_usage_events
    WHERE created_at >= $1 AND created_at <= $2${filter.clause}
    GROUP BY bucket_start
    ORDER BY bucket_start ASC
    `,
    [range.from.toISOString(), range.to.toISOString(), safeBucket, ...filter.values],
  );

  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    bucket: safeBucket,
    points: result.rows.map((row) => ({
      bucket_start: new Date(row.bucket_start).toISOString(),
      request_count: toNumber(row.request_count),
      total_tokens: toNumber(row.total_tokens),
      estimated_cost_usd: Number(toNumber(row.estimated_cost_usd).toFixed(8)),
    })),
  };
}

async function getUsageByModel(from, to, userId = null) {
  const db = getPool();
  const range = normalizeRange(from, to);
  const filter = buildUserFilter(userId, 3);

  const result = await db.query(
    `
    SELECT
      provider,
      model,
      COUNT(*)::int AS request_count,
      COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,
      COALESCE(SUM(output_tokens),0)::bigint AS output_tokens,
      COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,
      COALESCE(SUM(estimated_cost_usd),0)::numeric AS estimated_cost_usd
    FROM llm_usage_events
    WHERE created_at >= $1 AND created_at <= $2${filter.clause}
    GROUP BY provider, model
    ORDER BY total_tokens DESC, request_count DESC
    `,
    [range.from.toISOString(), range.to.toISOString(), ...filter.values],
  );

  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    rows: result.rows.map((row) => ({
      provider: row.provider,
      model: row.model,
      request_count: toNumber(row.request_count),
      input_tokens: toNumber(row.input_tokens),
      output_tokens: toNumber(row.output_tokens),
      total_tokens: toNumber(row.total_tokens),
      estimated_cost_usd: Number(toNumber(row.estimated_cost_usd).toFixed(8)),
    })),
  };
}

async function getUsagePerf(windowName, userId = null) {
  const db = getPool();
  const minutes = windowName === '1h' ? 60 : windowName === '15m' ? 15 : 5;
  const filter = buildUserFilter(userId, 2);

  const result = await db.query(
    `
    SELECT
      COUNT(*)::int AS request_count,
      COALESCE(SUM(total_tokens),0)::bigint AS total_tokens
    FROM llm_usage_events
    WHERE created_at >= NOW() - ($1::text || ' minutes')::interval${filter.clause}
    `,
    [String(minutes), ...filter.values],
  );

  const row = result.rows[0];
  const requestCount = toNumber(row.request_count);
  const totalTokens = toNumber(row.total_tokens);

  return {
    window: windowName,
    request_count: requestCount,
    total_tokens: totalTokens,
    rpm: Number((requestCount / minutes).toFixed(3)),
    tpm: Number((totalTokens / minutes).toFixed(3)),
  };
}

async function getUsageRequests(from, to, limit, cursor, userId = null) {
  const db = getPool();
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), USAGE_REQUESTS_MAX_LIMIT);
  const range = normalizeRange(from, to);

  const values = [range.from.toISOString(), range.to.toISOString(), safeLimit + 1];
  const filter = buildUserFilter(userId, values.length + 1);
  values.push(...filter.values);
  let cursorClause = '';
  if (cursor) {
    values.push(cursor);
    cursorClause = ` AND id < $${values.length}`;
  }

  const result = await db.query(
    `
    SELECT
      id,
      created_at,
      provider,
      model,
      endpoint,
      status_code,
      error_code,
      latency_ms,
      input_tokens,
      output_tokens,
      total_tokens,
      estimated_cost_usd
    FROM llm_usage_events
    WHERE created_at >= $1 AND created_at <= $2${filter.clause}
    ${cursorClause}
    ORDER BY id DESC
    LIMIT $3
    `,
    values,
  );

  const hasMore = result.rows.length > safeLimit;
  const rows = hasMore ? result.rows.slice(0, safeLimit) : result.rows;
  const nextCursor = hasMore ? String(rows[rows.length - 1].id) : null;

  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    limit: safeLimit,
    next_cursor: nextCursor,
    rows: rows.map((row) => ({
      id: String(row.id),
      created_at: new Date(row.created_at).toISOString(),
      provider: row.provider,
      model: row.model,
      endpoint: row.endpoint,
      status_code: toNumber(row.status_code),
      error_code: row.error_code,
      latency_ms: toNumber(row.latency_ms),
      input_tokens: toNumber(row.input_tokens),
      output_tokens: toNumber(row.output_tokens),
      total_tokens: toNumber(row.total_tokens),
      estimated_cost_usd: Number(toNumber(row.estimated_cost_usd).toFixed(8)),
    })),
  };
}

async function purgeOldUsage(retentionDays = USAGE_RETENTION_DAYS) {
  const db = getPool();
  const result = await db.query(
    `
    DELETE FROM llm_usage_events
    WHERE created_at < NOW() - ($1::text || ' days')::interval
    `,
    [String(retentionDays)],
  );

  return result.rowCount || 0;
}

function startRetentionPurgeScheduler(retentionDays = USAGE_RETENTION_DAYS) {
  if (!isDatabaseConfigured() || retentionTimer) {
    return;
  }

  retentionTimer = setInterval(() => {
    purgeOldUsage(retentionDays).catch((error) => {
      console.error('Retention purge failed:', error.message);
    });
  }, 24 * 60 * 60 * 1000);

  if (typeof retentionTimer.unref === 'function') {
    retentionTimer.unref();
  }
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hashPaymentPayload(payload) {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
  return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}

async function recordPaymentEvent({ provider, eventId, eventType, payload }) {
  const db = getPool();
  const result = await db.query(
    `
    INSERT INTO payment_events (provider, event_id, event_type, payload_hash, payload)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    ON CONFLICT (provider, event_id) DO NOTHING
    RETURNING id
    `,
    [
      provider,
      eventId,
      eventType,
      hashPaymentPayload(payload),
      JSON.stringify(payload || {}),
    ],
  );

  return {
    inserted: result.rowCount > 0,
  };
}

async function upsertUserSubscription(record) {
  const db = getPool();
  const result = await db.query(
    `
    INSERT INTO user_subscriptions (
      user_id,
      provider,
      status,
      stripe_customer_id,
      stripe_subscription_id,
      stripe_price_id,
      current_period_end,
      cancel_at_period_end,
      metadata,
      created_at,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW(),NOW())
    ON CONFLICT (user_id, provider)
    DO UPDATE SET
      status = EXCLUDED.status,
      stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, user_subscriptions.stripe_customer_id),
      stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, user_subscriptions.stripe_subscription_id),
      stripe_price_id = COALESCE(EXCLUDED.stripe_price_id, user_subscriptions.stripe_price_id),
      current_period_end = COALESCE(EXCLUDED.current_period_end, user_subscriptions.current_period_end),
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING
      user_id,
      provider,
      status,
      stripe_customer_id,
      stripe_subscription_id,
      stripe_price_id,
      current_period_end,
      cancel_at_period_end,
      metadata,
      created_at,
      updated_at
    `,
    [
      record.user_id,
      record.provider,
      record.status,
      record.stripe_customer_id || null,
      record.stripe_subscription_id || null,
      record.stripe_price_id || null,
      toIsoOrNull(record.current_period_end),
      Boolean(record.cancel_at_period_end),
      JSON.stringify(record.metadata || {}),
    ],
  );

  return result.rows[0] || null;
}

async function getUserSubscription(userId, provider = 'stripe') {
  const db = getPool();
  const result = await db.query(
    `
    SELECT
      user_id,
      provider,
      status,
      stripe_customer_id,
      stripe_subscription_id,
      stripe_price_id,
      current_period_end,
      cancel_at_period_end,
      metadata,
      created_at,
      updated_at
    FROM user_subscriptions
    WHERE user_id = $1 AND provider = $2
    LIMIT 1
    `,
    [userId, provider],
  );
  return result.rows[0] || null;
}

async function getManagedUsageForPeriod(from, to) {
  const db = getPool();
  const range = normalizeRange(from, to);

  const result = await db.query(
    `
    SELECT
      u.user_id,
      u.stripe_customer_id,
      COALESCE(u.metadata->>'plan_id', 'pro') AS plan_id,
      COALESCE(SUM(e.input_tokens), 0)::bigint AS input_tokens,
      COALESCE(SUM(e.output_tokens), 0)::bigint AS output_tokens
    FROM user_subscriptions u
    LEFT JOIN llm_usage_events e
      ON e.user_id = u.user_id
     AND e.created_at >= $1
     AND e.created_at <= $2
    WHERE u.provider = 'stripe'
      AND u.status IN ('active', 'trialing')
      AND COALESCE(u.metadata->>'plan_id', '') IN ('pro', 'scale')
      AND u.stripe_customer_id IS NOT NULL
    GROUP BY u.user_id, u.stripe_customer_id, COALESCE(u.metadata->>'plan_id', 'pro')
    `,
    [range.from.toISOString(), range.to.toISOString()],
  );

  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    rows: result.rows.map((row) => ({
      user_id: row.user_id,
      stripe_customer_id: row.stripe_customer_id,
      plan_id: row.plan_id,
      input_tokens: Number(row.input_tokens || 0),
      output_tokens: Number(row.output_tokens || 0),
    })),
  };
}

async function recordStripeUsageSyncRun({ userId, periodStart, periodEnd, meterType, quantity, idempotencyKey }) {
  const db = getPool();
  const result = await db.query(
    `
    INSERT INTO stripe_usage_sync_runs (
      user_id,
      period_start,
      period_end,
      meter_type,
      quantity,
      idempotency_key
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
    `,
    [userId, periodStart, periodEnd, meterType, quantity, idempotencyKey],
  );

  return { inserted: result.rowCount > 0 };
}

async function closeDatabase() {
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = undefined;
  }

  if (pool) {
    await pool.end();
    pool = undefined;
    initialized = false;
  }
}

module.exports = {
  SEEDED_MODEL_PRICING,
  calculateEstimatedCost,
  closeDatabase,
  estimateCostUsd,
  getUsageByModel,
  getUsagePerf,
  getUsageRequests,
  getManagedUsageForPeriod,
  getUsageSummary,
  getUsageTrend,
  getUserSubscription,
  hashPaymentPayload,
  initDatabase,
  isDatabaseConfigured,
  logUsageEvent,
  normalizeRange,
  purgeOldUsage,
  recordPaymentEvent,
  recordStripeUsageSyncRun,
  startRetentionPurgeScheduler,
  upsertUserSubscription,
};
