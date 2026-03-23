'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

function loadAppWithEnv({ adminToken, databaseUrl }) {
  if (adminToken === undefined) {
    delete process.env.CONSOLE_ADMIN_TOKEN;
  } else {
    process.env.CONSOLE_ADMIN_TOKEN = adminToken;
  }

  if (databaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = databaseUrl;
  }

  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/auth')];
  delete require.cache[require.resolve('../src/db')];
  delete require.cache[require.resolve('../src/providers')];
  delete require.cache[require.resolve('../src/rate-limit')];
  delete require.cache[require.resolve('../src/app')];

  const { createApp } = require('../src/app');
  return createApp();
}

test('health endpoint keeps working without DATABASE_URL', async () => {
  const app = loadAppWithEnv({ adminToken: 'secret-token', databaseUrl: undefined });

  const response = await request(app)
    .get('/health')
    .set('accept', 'application/json');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
});

test('protected usage endpoints require token and database config', async () => {
  const app = loadAppWithEnv({ adminToken: 'secret-token', databaseUrl: undefined });

  const unauthorized = await request(app).get('/api/usage/summary');
  assert.equal(unauthorized.status, 401);

  const noDb = await request(app)
    .get('/api/usage/summary')
    .set('x-admin-token', 'secret-token');

  assert.equal(noDb.status, 503);
  assert.equal(noDb.body.error.code, 'config_missing_database_url');
});
