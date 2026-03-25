'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('health page uses same-origin health endpoints', () => {
  const healthPath = path.join(__dirname, '..', 'public', 'health.html');
  const html = fs.readFileSync(healthPath, 'utf8');

  assert.ok(html.includes("const API_BASE_URL = '';"), 'API_BASE_URL should be same-origin');
  assert.ok(html.includes('href="/health.json"'), 'health links should be relative');
  assert.ok(!html.includes('openclaw-control-plane.onrender.com'), 'should not hardcode hosted control-plane domain');
});
