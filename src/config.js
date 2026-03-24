'use strict';

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toBoundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function toList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function toOneOf(value, fallback, allowed) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return allowed.includes(normalized) ? normalized : fallback;
}

module.exports = {
  PORT: toPositiveInt(process.env.PORT, 3000),
  DATABASE_URL: process.env.DATABASE_URL || '',
  CONSOLE_ADMIN_TOKEN: process.env.CONSOLE_ADMIN_TOKEN || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  USER_KEYS_ENCRYPTION_KEY: process.env.USER_KEYS_ENCRYPTION_KEY || '',
  USAGE_RETENTION_DAYS: toBoundedInt(process.env.USAGE_RETENTION_DAYS, 90, 1, 3650),
  PROXY_UPSTREAM_TIMEOUT_MS: toBoundedInt(process.env.PROXY_UPSTREAM_TIMEOUT_MS, 30000, 1000, 120000),
  PROXY_RATE_LIMIT_MAX_REQUESTS: toBoundedInt(process.env.PROXY_RATE_LIMIT_MAX_REQUESTS, 60, 1, 5000),
  PROXY_RATE_LIMIT_WINDOW_MS: toBoundedInt(process.env.PROXY_RATE_LIMIT_WINDOW_MS, 60000, 1000, 3600000),
  PG_SSL_INSECURE_ALLOW: toBool(process.env.PG_SSL_INSECURE_ALLOW, false),
  ALLOWED_LLM_PROVIDERS: toList(process.env.ALLOWED_LLM_PROVIDERS),
  ALLOWED_LLM_MODELS: toList(process.env.ALLOWED_LLM_MODELS),
  SECURITY_HEADERS_ENABLED: toBool(process.env.SECURITY_HEADERS_ENABLED, true),
  CORS_ALLOWED_ORIGINS: toList(process.env.CORS_ALLOWED_ORIGINS),
  TRUST_PROXY: toBool(process.env.TRUST_PROXY, false),
  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME || 'openclaw_session',
  SESSION_COOKIE_SAMESITE: toOneOf(process.env.SESSION_COOKIE_SAMESITE, 'lax', ['lax', 'strict', 'none']),
  SESSION_COOKIE_SECURE: toOneOf(process.env.SESSION_COOKIE_SECURE, 'auto', ['auto', 'true', 'false']),
  SESSION_COOKIE_DOMAIN: process.env.SESSION_COOKIE_DOMAIN || '',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  STRIPE_SUCCESS_URL: process.env.STRIPE_SUCCESS_URL || '',
  STRIPE_CANCEL_URL: process.env.STRIPE_CANCEL_URL || '',
  STRIPE_WEBHOOK_TOLERANCE_SECONDS: toBoundedInt(process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS, 300, 30, 3600),
};
