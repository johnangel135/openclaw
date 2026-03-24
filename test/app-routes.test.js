'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

function loadAppWithEnv({ adminToken, databaseUrl, nodeEnv }) {
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

  if (nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = nodeEnv;
  }

  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/auth')];
  delete require.cache[require.resolve('../src/db')];
  delete require.cache[require.resolve('../src/providers')];
  delete require.cache[require.resolve('../src/rate-limit')];
  delete require.cache[require.resolve('../src/user-auth')];
  delete require.cache[require.resolve('../src/app')];

  const { createApp } = require('../src/app');
  const userAuth = require('../src/user-auth');
  return { app: createApp(), userAuth };
}

test('health endpoint keeps working without DATABASE_URL', async () => {
  const { app } = loadAppWithEnv({ adminToken: 'secret-token', databaseUrl: undefined });

  const response = await request(app)
    .get('/health')
    .set('accept', 'application/json');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
});

test('protected usage endpoints require token and database config', async () => {
  const { app } = loadAppWithEnv({ adminToken: 'secret-token', databaseUrl: undefined });

  const unauthorized = await request(app).get('/api/usage/summary');
  assert.equal(unauthorized.status, 401);

  const noDb = await request(app)
    .get('/api/usage/summary')
    .set('x-admin-token', 'secret-token');

  assert.equal(noDb.status, 503);
  assert.equal(noDb.body.error.code, 'config_missing_database_url');
});

test('session cookie includes secure attributes in production', async () => {
  const { userAuth } = loadAppWithEnv({ adminToken: 'secret-token', databaseUrl: undefined, nodeEnv: 'production' });

  const headers = {};
  const mockResponse = {
    setHeader(name, value) {
      headers[name] = value;
    },
  };

  userAuth.setSessionCookie(mockResponse, 'token-value');

  const cookie = headers['Set-Cookie'];
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
});

test('blocks cross-site logout and user mutating requests without same-origin header', async () => {
  const { app, userAuth } = loadAppWithEnv({ adminToken: 'secret-token', databaseUrl: undefined });
  const token = userAuth.createSession({ id: 'u1', email: 'u1@example.com' });

  const logoutBlocked = await request(app)
    .post('/auth/logout');

  assert.equal(logoutBlocked.status, 403);
  assert.equal(logoutBlocked.body.error.code, 'csrf_blocked');

  const userPostBlocked = await request(app)
    .post('/api/user/infer')
    .set('Cookie', `openclaw_session=${token}`)
    .send({ model: 'gpt-4o-mini', input: 'hello' });

  assert.equal(userPostBlocked.status, 403);
  assert.equal(userPostBlocked.body.error.code, 'csrf_blocked');

  const userPostAllowed = await request(app)
    .post('/api/user/infer')
    .set('Cookie', `openclaw_session=${token}`)
    .set('origin', 'http://127.0.0.1')
    .set('host', '127.0.0.1')
    .send({ model: 'gpt-4o-mini', input: 'hello' });

  assert.equal(userPostAllowed.status, 503);
  assert.equal(userPostAllowed.body.error.code, 'config_missing_database_url');
});

