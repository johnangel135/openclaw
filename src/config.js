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

module.exports = {
  PORT: toPositiveInt(process.env.PORT, 3000),
  DATABASE_URL: process.env.DATABASE_URL || '',
  CONSOLE_ADMIN_TOKEN: process.env.CONSOLE_ADMIN_TOKEN || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  USAGE_RETENTION_DAYS: toBoundedInt(process.env.USAGE_RETENTION_DAYS, 90, 1, 3650),
  PROXY_UPSTREAM_TIMEOUT_MS: toBoundedInt(process.env.PROXY_UPSTREAM_TIMEOUT_MS, 30000, 1000, 120000),
  PROXY_RATE_LIMIT_MAX_REQUESTS: toBoundedInt(process.env.PROXY_RATE_LIMIT_MAX_REQUESTS, 60, 1, 5000),
  PROXY_RATE_LIMIT_WINDOW_MS: toBoundedInt(process.env.PROXY_RATE_LIMIT_WINDOW_MS, 60000, 1000, 3600000),
};
