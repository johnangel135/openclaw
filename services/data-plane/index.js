'use strict';

const express = require('express');
const compression = require('compression');

const PORT = Number(process.env.PORT || 10000);
const CONTROL_PLANE_URL = String(process.env.CONTROL_PLANE_URL || '').replace(/\/$/, '');
const DATA_PLANE_SHARED_TOKEN = String(process.env.DATA_PLANE_SHARED_TOKEN || '').trim();

if (!CONTROL_PLANE_URL) {
  // eslint-disable-next-line no-console
  console.error('Missing CONTROL_PLANE_URL');
  process.exit(1);
}

if (!DATA_PLANE_SHARED_TOKEN) {
  // eslint-disable-next-line no-console
  console.error('Missing DATA_PLANE_SHARED_TOKEN');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'openclaw-data-plane',
    control_plane_url: CONTROL_PLANE_URL,
    timestamp: new Date().toISOString(),
  });
});

async function forward(req, res, path) {
  try {
    const upstream = await fetch(`${CONTROL_PLANE_URL}${path}`, {
      method: req.method,
      headers: {
        'content-type': req.get('content-type') || 'application/json',
        'x-data-plane-token': DATA_PLANE_SHARED_TOKEN,
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {}),
    });

    const text = await upstream.text();
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    res.send(text);
  } catch (error) {
    res.status(502).json({
      error: {
        code: 'control_plane_unreachable',
        message: error.message,
      },
    });
  }
}

app.post('/v1/infer', (req, res) => forward(req, res, '/api/internal/infer'));
app.post('/v1/chat/completions', (req, res) => forward(req, res, '/v1/chat/completions'));
app.post('/v1/responses', (req, res) => forward(req, res, '/v1/responses'));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Data plane listening on :${PORT}`);
});
