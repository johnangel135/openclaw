'use strict';

const express = require('express');
const path = require('path');

const { requireAdminToken, extractAdminToken } = require('./auth');
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
const { createRateLimiter } = require('./rate-limit');
const {
  PROXY_RATE_LIMIT_MAX_REQUESTS,
  PROXY_RATE_LIMIT_WINDOW_MS,
  PROXY_UPSTREAM_TIMEOUT_MS,
} = require('./config');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const CONSOLE_FILE = path.join(__dirname, 'console.html');

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
  return parsed;
}

function serializeUsage(usage) {
  return {
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    total_tokens: usage.total_tokens || 0,
  };
}

async function runProxyAndTrack({ inferPayload, endpointName, responseFormatter }) {
  const startedAt = Date.now();
  const provider = (inferPayload.provider || 'openai').toLowerCase();
  const model = inferPayload.model || 'unknown';

  try {
    const result = await invokeInfer(inferPayload, PROXY_UPSTREAM_TIMEOUT_MS);
    const usage = serializeUsage(result.usage || {});
    const estimatedCostUsd = await estimateCostUsd(result.provider, result.model, usage.input_tokens, usage.output_tokens);

    await logUsageEvent({
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

function createApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  // Serve static files from public directory.
  app.use(express.static(PUBLIC_DIR));

  app.get('/health', (req, res) => {
    const healthData = getHealthData();
    const acceptHeader = req.get('accept') || '';
    const wantsHtml = acceptHeader.includes('text/html');
    const wantsJson = req.query.format === 'json' || acceptHeader.includes('application/json');

    res.set('Cache-Control', 'no-store');

    if (wantsHtml && !wantsJson) {
      return res.sendFile(path.join(PUBLIC_DIR, 'health.html'));
    }

    return res.json(healthData);
  });

  app.get('/health.json', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(getHealthData());
  });

  const proxyRateLimiter = createRateLimiter({
    maxRequests: PROXY_RATE_LIMIT_MAX_REQUESTS,
    windowMs: PROXY_RATE_LIMIT_WINDOW_MS,
    keyFn: (req) => {
      const token = extractAdminToken(req);
      return token ? `token:${token}` : `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
    },
  });

  app.use('/api/llm', requireAdminToken, proxyRateLimiter);
  app.use('/v1/chat/completions', requireAdminToken, proxyRateLimiter);
  app.use('/v1/responses', requireAdminToken, proxyRateLimiter);
  app.use('/api/usage', requireAdminToken);

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
    if (!requireDatabase(res)) {
      return;
    }

    const limit = parseLimit(req.query.limit, 20);
    const data = await getUsageRequests(req.query.from, req.query.to, limit, req.query.cursor);
    res.json(data);
  }));

  app.get('/console', requireAdminToken, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(CONSOLE_FILE);
  });

  // Catch-all: serve index.html.
  app.get('*', (req, res) => {
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
  runProxyAndTrack,
};
