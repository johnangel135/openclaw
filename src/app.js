'use strict';

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');

const { requireAdminToken, extractAdminToken } = require('./auth');
const {
  authenticateUser,
  clearSessionCookie,
  createSession,
  createUser,
  getSessionUser,
  getUserApiKeys,
  initSessionStore,
  maskApiKeys,
  requireUserSession,
  setSessionCookie,
  updateUserApiKeys,
} = require('./user-auth');
const {
  estimateCostUsd,
  getUsageByModel,
  getUsagePerf,
  getUsageRequests,
  getUsageSummary,
  getUsageTrend,
  isDatabaseConfigured,
  logUsageEvent,
} = require('./db');
const {
  ProxyError,
  invokeInfer,
  mapOpenAIChatToInfer,
  mapOpenAIResponsesToInfer,
  toOpenAIChatResponse,
  toOpenAIResponsesResponse,
} = require('./providers');
const { createRateLimiter, createAuthThrottle, createLimiterDependencies } = require('./rate-limit');
const {
  createStripeBillingPortalSession,
  createStripeCheckoutSession,
  getPaymentReadiness,
  getUserEntitlement,
  processStripeWebhookEvent,
  verifyStripeWebhookSignature,
} = require('./payments');
const { getPricingPlans } = require('./pricing-plans');
const {
  CORS_ALLOWED_ORIGINS,
  PROXY_RATE_LIMIT_MAX_REQUESTS,
  PROXY_RATE_LIMIT_WINDOW_MS,
  PROXY_UPSTREAM_TIMEOUT_MS,
  SECURITY_HEADERS_ENABLED,
  TRUST_PROXY,
  USAGE_REQUESTS_MAX_LIMIT,
} = require('./config');
const { hashIdentifier, logSecurityEvent } = require('./security-log');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const CONSOLE_FILE = path.join(__dirname, 'console.html');
const AUTH_FILE = path.join(__dirname, 'auth.html');

function getHealthData() {
  return {
    status: 'ok',
    service: 'openclaw',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };
}

function makeErrorPayload(error, fallbackStatus = 500, fallbackCode = 'internal_error') {
  const statusCode = error?.statusCode || fallbackStatus;
  const errorCode = error?.errorCode || fallbackCode;
  const message = error?.message || 'Unexpected error';

  return {
    statusCode,
    payload: {
      error: {
        message,
        code: errorCode,
      },
    },
  };
}

function requireDatabase(res) {
  if (isDatabaseConfigured()) {
    return true;
  }

  res.status(503).json({
    error: {
      message: 'DATABASE_URL is not configured',
      code: 'config_missing_database_url',
    },
  });
  return false;
}

function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function parseLimit(limitRaw, fallback) {
  const parsed = Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, 1), USAGE_REQUESTS_MAX_LIMIT);
}

function parseCursor(cursorRaw) {
  if (cursorRaw === undefined || cursorRaw === null || cursorRaw === '') {
    return { ok: true, value: null };
  }

  const value = String(cursorRaw).trim();
  if (!/^\d+$/.test(value)) {
    return { ok: false, value: null };
  }

  return { ok: true, value };
}

function setPublicPageCache(res) {
  res.set('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
}

function getRequestOrigin(req) {
  const host = req.get('x-forwarded-host') || req.get('host');
  if (!host) return '';

  const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${host}`;
}

function isSameOrigin(urlValue, origin) {
  if (!urlValue || !origin) return false;
  try {
    const parsed = new URL(urlValue);
    return parsed.origin === origin;
  } catch {
    return false;
  }
}

function requireSameOriginForMutations(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next();
    return;
  }

  const expectedOrigin = getRequestOrigin(req);
  const requestOrigin = req.get('origin');
  const referer = req.get('referer');

  const valid = isSameOrigin(requestOrigin, expectedOrigin)
    || (!requestOrigin && isSameOrigin(referer, expectedOrigin));

  if (!valid) {
    logSecurityEvent('csrf_blocked', req, {
      request_origin: requestOrigin || null,
      referer: referer || null,
      expected_origin: expectedOrigin || null,
    });
    res.status(403).json({
      error: {
        message: 'Cross-site request blocked',
        code: 'csrf_blocked',
      },
    });
    return;
  }

  next();
}

function applyCors(req, res, next) {
  if (!CORS_ALLOWED_ORIGINS.length) {
    next();
    return;
  }

  const origin = String(req.get('origin') || '').toLowerCase();
  if (origin && CORS_ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', req.get('origin'));
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.set('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

function authThrottleKey(req) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return `auth:${email || 'unknown'}:${ip}`;
}

function serializeUsage(usage) {
  return {
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    total_tokens: usage.total_tokens || 0,
  };
}

async function runProxyAndTrack({ inferPayload, endpointName, responseFormatter, userId = null, apiKeys = {} }) {
  const startedAt = Date.now();
  const provider = (inferPayload.provider || 'openai').toLowerCase();
  const model = inferPayload.model || 'unknown';

  try {
    const result = await invokeInfer(inferPayload, PROXY_UPSTREAM_TIMEOUT_MS, apiKeys);
    const usage = serializeUsage(result.usage || {});
    const estimatedCostUsd = await estimateCostUsd(result.provider, result.model, usage.input_tokens, usage.output_tokens);

    await logUsageEvent({
      user_id: userId,
      provider: result.provider,
      model: result.model,
      endpoint: endpointName,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
      estimated_cost_usd: estimatedCostUsd,
      latency_ms: Date.now() - startedAt,
      status_code: result.upstream_status_code || 200,
      error_code: null,
    });

    return {
      statusCode: 200,
      body: responseFormatter({
        ...result,
        usage,
        estimated_cost_usd: estimatedCostUsd,
      }),
    };
  } catch (error) {
    const mapped = makeErrorPayload(error, 502, 'upstream_error');

    try {
      await logUsageEvent({
        user_id: userId,
        provider,
        model,
        endpoint: endpointName,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        latency_ms: Date.now() - startedAt,
        status_code: mapped.statusCode,
        error_code: mapped.payload.error.code,
      });
    } catch (loggingError) {
      console.error('Failed to write usage event:', loggingError.message);
    }

    return {
      statusCode: mapped.statusCode,
      body: mapped.payload,
    };
  }
}

async function createApp() {
  const app = express();

  const limiterDeps = await createLimiterDependencies();
  await initSessionStore();

  if (TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  if (SECURITY_HEADERS_ENABLED) {
    app.use(helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }));
  }

  app.use(applyCors);
  app.use(compression());
  app.use(express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }));

  // Serve static files from public directory.
  app.use(express.static(PUBLIC_DIR));

  const authBlockedLogger = (req, retryAfterSeconds) => {
    logSecurityEvent('auth_rate_limited', req, {
      email_hash: hashIdentifier(req.body?.email),
      retry_after_seconds: retryAfterSeconds,
    });
  };
  const signupThrottle = createAuthThrottle({
    keyFn: authThrottleKey,
    onBlocked: authBlockedLogger,
    store: limiterDeps.authThrottleStore,
  });
  const loginThrottle = createAuthThrottle({
    keyFn: authThrottleKey,
    onBlocked: authBlockedLogger,
    store: limiterDeps.authThrottleStore,
  });

  app.get('/auth', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(AUTH_FILE);
  });

  app.get('/auth/login', (req, res) => {
    res.redirect('/auth?mode=login');
  });

  app.get('/auth/signup', (req, res) => {
    res.redirect('/auth?mode=signup');
  });

  app.post('/auth/signup', signupThrottle.preflight, asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    const emailHash = hashIdentifier(email);
    try {
      const user = await createUser(email, password);
      signupThrottle.recordSuccess(req);
      const token = await createSession(user);
      setSessionCookie(req, res, token);
      logSecurityEvent('auth_signup_success', req, { email_hash: emailHash, user_id: user.id });
      res.status(201).json({ user });
    } catch (error) {
      signupThrottle.recordFailure(req);
      const code = String(error.message || '').includes('exists') ? 409 : 400;
      logSecurityEvent('auth_signup_failed', req, { email_hash: emailHash, reason: String(error.message || 'invalid_signup') });
      res.status(code).json({ error: { message: error.message, code: 'invalid_signup' } });
    }
  }));

  app.post('/auth/login', loginThrottle.preflight, asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    const emailHash = hashIdentifier(email);
    const user = await authenticateUser(email, password);
    if (!user) {
      loginThrottle.recordFailure(req);
      logSecurityEvent('auth_login_failed', req, { email_hash: emailHash, reason: 'invalid_credentials' });
      res.status(401).json({ error: { message: 'Invalid email/password', code: 'unauthorized' } });
      return;
    }
    loginThrottle.recordSuccess(req);
    const token = await createSession(user);
    setSessionCookie(req, res, token);
    logSecurityEvent('auth_login_success', req, { email_hash: emailHash, user_id: user.id });
    res.json({ user });
  }));

  app.post('/auth/logout', requireSameOriginForMutations, asyncHandler(async (req, res) => {
    const user = await getSessionUser(req);
    await clearSessionCookie(req, res);
    logSecurityEvent('auth_logout', req, { user_id: user?.id || null });
    res.json({ ok: true });
  }));

  app.get('/auth/me', asyncHandler(async (req, res) => {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: { message: 'Login required', code: 'unauthorized' } });
      return;
    }
    res.json({ user });
  }));

  app.get('/health', (req, res) => {
    const healthData = getHealthData();
    const acceptHeader = req.get('accept') || '';
    const wantsHtml = acceptHeader.includes('text/html');
    const wantsJson = req.query.format === 'json' || acceptHeader.includes('application/json');

    if (wantsHtml && !wantsJson) {
      setPublicPageCache(res);
      return res.sendFile(path.join(PUBLIC_DIR, 'health.html'));
    }

    res.set('Cache-Control', 'no-store');
    return res.json(healthData);
  });

  app.get('/health.json', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(getHealthData());
  });

  app.get('/api/payments/readiness', (req, res) => {
    const readiness = getPaymentReadiness();
    const plans = getPricingPlans();
    res.json({
      enabled: readiness.enabled,
      missing: readiness.missing,
      plans,
    });
  });

  app.get('/api/payments/plans', (req, res) => {
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.json({ plans: getPricingPlans() });
  });

  app.post('/api/user/payments/checkout-session', requireUserSession, requireSameOriginForMutations, asyncHandler(async (req, res) => {
    const result = await createStripeCheckoutSession({
      userId: req.user.id,
      customerEmail: req.user.email,
      planId: req.body?.plan_id,
      origin: getRequestOrigin(req),
    });
    res.status(result.statusCode).json(result.payload);
  }));

  app.post('/api/user/payments/billing-portal', requireUserSession, requireSameOriginForMutations, asyncHandler(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }

    const result = await createStripeBillingPortalSession({
      userId: req.user.id,
      origin: getRequestOrigin(req),
    });
    res.status(result.statusCode).json(result.payload);
  }));

  app.get('/api/user/subscription', requireUserSession, asyncHandler(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }

    const entitlement = await getUserEntitlement(req.user.id);
    res.json({ entitlement });
  }));

  app.post('/api/payments/webhook/stripe', asyncHandler(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }

    const verification = verifyStripeWebhookSignature(req.rawBody, req.get('stripe-signature'));
    if (!verification.ok) {
      res.status(400).json({
        error: {
          message: 'Invalid Stripe signature',
          code: verification.reason,
        },
      });
      return;
    }

    const result = await processStripeWebhookEvent(req.body || {});
    res.status(result.statusCode).json(result.payload);
  }));

  const proxyRateLimiter = createRateLimiter({
    maxRequests: PROXY_RATE_LIMIT_MAX_REQUESTS,
    windowMs: PROXY_RATE_LIMIT_WINDOW_MS,
    store: limiterDeps.rateLimitStore,
    keyFn: (req) => {
      const token = extractAdminToken(req);
      return token ? `token:${token}` : `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
    },
  });

  app.use('/api/llm', requireAdminToken, proxyRateLimiter);
  app.use('/v1/chat/completions', requireAdminToken, proxyRateLimiter);
  app.use('/v1/responses', requireAdminToken, proxyRateLimiter);
  app.use('/api/usage', requireAdminToken);

  app.use('/api/user/infer', requireUserSession, proxyRateLimiter);
  app.use('/api/user/usage', requireUserSession);

  app.get('/api/user/api-keys', requireUserSession, asyncHandler(async (req, res) => {
    const keys = await getUserApiKeys(req.user.id) || {};
    res.json({ keys: maskApiKeys(keys) });
  }));

  app.post('/api/user/api-keys', requireUserSession, requireSameOriginForMutations, asyncHandler(async (req, res) => {
    const keys = await updateUserApiKeys(req.user.id, req.body || {});
    res.json({ keys });
  }));

  app.post('/api/llm/infer', asyncHandler(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }

    const inferPayload = req.body || {};
    const result = await runProxyAndTrack({
      inferPayload,
      endpointName: '/api/llm/infer',
      responseFormatter: (value) => ({
        provider: value.provider,
        model: value.model,
        status_code: value.upstream_status_code,
        output_text: value.output_text,
        usage: value.usage,
        estimated_cost_usd: value.estimated_cost_usd,
        raw_response: value.raw_response,
      }),
    });

    res.status(result.statusCode).json(result.body);
  }));

  app.post('/api/user/infer', requireSameOriginForMutations, asyncHandler(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }

    const inferPayload = req.body || {};
    const userKeys = await getUserApiKeys(req.user.id) || {};
    const result = await runProxyAndTrack({
      inferPayload,
      endpointName: '/api/user/infer',
      userId: req.user.id,
      apiKeys: userKeys,
      responseFormatter: (value) => ({
        provider: value.provider,
        model: value.model,
        status_code: value.upstream_status_code,
        output_text: value.output_text,
        usage: value.usage,
        estimated_cost_usd: value.estimated_cost_usd,
        raw_response: value.raw_response,
      }),
    });

    res.status(result.statusCode).json(result.body);
  }));

  app.post('/v1/chat/completions', asyncHandler(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }

    const inferPayload = mapOpenAIChatToInfer(req.body || {});
    const result = await runProxyAndTrack({
      inferPayload,
      endpointName: '/v1/chat/completions',
      responseFormatter: (value) => toOpenAIChatResponse(value),
    });

    res.status(result.statusCode).json(result.body);
  }));

  app.post('/v1/responses', asyncHandler(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }

    const inferPayload = mapOpenAIResponsesToInfer(req.body || {});
    const result = await runProxyAndTrack({
      inferPayload,
      endpointName: '/v1/responses',
      responseFormatter: (value) => toOpenAIResponsesResponse(value),
    });

    res.status(result.statusCode).json(result.body);
  }));

  app.get('/api/usage/summary', asyncHandler(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }

    const data = await getUsageSummary(req.query.from, req.query.to);
    res.json(data);
  }));

  app.get('/api/usage/trend', asyncHandler(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }

    const bucket = req.query.bucket === 'day' ? 'day' : 'hour';
    const data = await getUsageTrend(req.query.from, req.query.to, bucket);
    res.json(data);
  }));

  app.get('/api/usage/by-model', asyncHandler(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }

    const data = await getUsageByModel(req.query.from, req.query.to);
    res.json(data);
  }));

  app.get('/api/usage/perf', asyncHandler(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }

    const window = req.query.window === '1h' || req.query.window === '15m' ? req.query.window : '5m';
    const data = await getUsagePerf(window);
    res.json(data);
  }));

  app.get('/api/usage/requests', asyncHandler(async (req, res) => {
    const cursor = parseCursor(req.query.cursor);
    if (!cursor.ok) {
      res.status(400).json({
        error: {
          message: 'Invalid cursor',
          code: 'invalid_cursor',
        },
      });
      return;
    }

    if (!requireDatabase(res)) {
      return;
    }

    const limit = parseLimit(req.query.limit, 20);
    const data = await getUsageRequests(req.query.from, req.query.to, limit, cursor.value);
    res.json(data);
  }));

  app.get('/api/user/usage/summary', asyncHandler(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const data = await getUsageSummary(req.query.from, req.query.to, req.user.id);
    res.json(data);
  }));

  app.get('/api/user/usage/trend', asyncHandler(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const bucket = req.query.bucket === 'day' ? 'day' : 'hour';
    const data = await getUsageTrend(req.query.from, req.query.to, bucket, req.user.id);
    res.json(data);
  }));

  app.get('/api/user/usage/by-model', asyncHandler(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const data = await getUsageByModel(req.query.from, req.query.to, req.user.id);
    res.json(data);
  }));

  app.get('/api/user/usage/perf', asyncHandler(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const window = req.query.window === '1h' || req.query.window === '15m' ? req.query.window : '5m';
    const data = await getUsagePerf(window, req.user.id);
    res.json(data);
  }));

  app.get('/api/user/usage/requests', asyncHandler(async (req, res) => {
    const cursor = parseCursor(req.query.cursor);
    if (!cursor.ok) {
      res.status(400).json({
        error: {
          message: 'Invalid cursor',
          code: 'invalid_cursor',
        },
      });
      return;
    }

    if (!requireDatabase(res)) {
      return;
    }
    const limit = parseLimit(req.query.limit, 20);
    const data = await getUsageRequests(req.query.from, req.query.to, limit, cursor.value, req.user.id);
    res.json(data);
  }));

  app.get('/console', asyncHandler(async (req, res) => {
    if (!await getSessionUser(req)) {
      res.redirect('/auth');
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.sendFile(CONSOLE_FILE);
  }));

  app.get('/api/*', (req, res) => {
    res.status(404).json({
      error: {
        message: 'Not found',
        code: 'not_found',
      },
    });
  });

  // Catch-all: serve index.html.
  app.get('*', (req, res) => {
    setPublicPageCache(res);
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      res.status(400).json({
        error: {
          message: 'Invalid JSON payload',
          code: 'invalid_json',
        },
      });
      return;
    }

    if (error instanceof ProxyError) {
      const mapped = makeErrorPayload(error, error.statusCode, error.errorCode);
      res.status(mapped.statusCode).json(mapped.payload);
      return;
    }

    console.error('Unhandled server error:', error);
    res.status(500).json({
      error: {
        message: 'Internal server error',
        code: 'internal_error',
      },
    });
  });

  return app;
}

module.exports = {
  createApp,
  getHealthData,
  parseLimit,
  runProxyAndTrack,
};
