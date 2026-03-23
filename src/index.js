'use strict';

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Serve static files from public directory
app.use(express.static(PUBLIC_DIR));

function getHealthData() {
  return {
    status: 'ok',
    service: 'openclaw',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };
}

// Health endpoint
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

// Catch-all: serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🌿 OpenClaw server running on http://localhost:${PORT}`);
});

module.exports = app;
