'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

async function loadAppWithEnv({ adminToken, databaseUrl, nodeEnv, corsAllowedOrigins, securityHeadersEnabled, redisUrl }) {
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

  if (corsAllowedOrigins === undefined) {
    delete process.env.CORS_ALLOWED_ORIGINS;
  } else {
    process.env.CORS_ALLOWED_ORIGINS = corsAllowedOrigins;
  }

  if (securityHeadersEnabled === undefined) {
    delete process.env.SECURITY_HEADERS_ENABLED;
  } else {
    process.env.SECURITY_HEADERS_ENABLED = securityHeadersEnabled;
  }

  if (redisUrl === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = redisUrl;
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
  return { app: await createApp(), userAuth };
}

test('health endpoint keeps working without DATABASE_URL', async () => {
  const { app } = await loadAppWithEnv({ adminToken: 'secret-token', databaseUrl: undefined });

  const response = await request(app)
    .get('/health')
    .set('accept', 'application/json');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
});

test('protected usage endpoints require token and database config', async () => {
  const { app } = await loadAppWithEnv({ adminToken: 'secret-token', databaseUrl: undefined });

  const unauthorized = await request(app).get('/api/usage/summary');
  assert.equal(unauthorized.status, 401);

  const noDb = await request(app)
    .get('/api/usage/summary')
    .set('x-admin-token', 'secret-token');

  assert.equal(noDb.status, 503);
  assert.equal(noDb.body.error.code, 'config_missing_database_url');
});

test('session cookie includes secure attributes in production', async () => {
  const { userAuth } = await loadAppWithEnv({ adminToken: 'secret-token', databaseUrl: undefined, nodeEnv: 'production' });

  const headers = {};
  const mockResponse = {
    setHeader(name, value) {
      headers[name] = value;
    },
  };

  userAuth.setSessionCookie({ secure: true }, mockResponse, 'token-value');

  const cookie = headers['Set-Cookie'];
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
});

test('blocks cross-site logout and user mutating requests without same-origin header', async () => {
  const { app, userAuth } = await loadAppWithEnv({ adminToken: 'secret-token', databaseUrl: undefined });
  const token = await userAuth.createSession({ id: 'u1', email: 'u1@example.com' });

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

test('auth page is served with accessibility and onboarding content', async () => {
  const { app } = await loadAppWithEnv({ adminToken: 'secret-token', databaseUrl: undefined });

  const response = await request(app)
    .get('/auth')
    .set('accept', 'text/html');

  assert.equal(response.status, 200);
  assert.match(response.text, /Skip to account forms/);
  assert.match(response.text, /Go to login/);
  assert.match(response.text, /Go to sign up/);
  assert.match(response.text, /role="status" aria-live="polite"/);
});

test('dedicated auth routes redirect to focused modes', async () => {
  const { app } = await loadAppWithEnv({ adminToken: 'secret-token', databaseUrl: undefined });

  const login = await request(app).get('/auth/login');
  assert.equal(login.status, 302);
  assert.equal(login.headers.location, '/auth?mode=login');

  const signup = await request(app).get('/auth/signup');
  assert.equal(signup.status, 302);
  assert.equal(signup.headers.location, '/auth?mode=signup');
});

test('console route redirects when logged out and serves dashboard when logged in', async () => {
  const { app, userAuth } = await loadAppWithEnv({ adminToken: 'secret-token', databaseUrl: undefined });

  const loggedOut = await request(app).get('/console');
  assert.equal(loggedOut.status, 302);
  assert.equal(loggedOut.headers.location, '/auth');

  const token = await userAuth.createSession({ id: 'u2', email: 'u2@example.com' });
  const loggedIn = await request(app)
    .get('/console')
    .set('Cookie', `openclaw_session=${token}`);

  assert.equal(loggedIn.status, 200);
  assert.match(loggedIn.text, /Your API Keys/);
  assert.match(loggedIn.text, /Leave a field blank to keep the currently saved key/);
  assert.match(loggedIn.text, /Quick start: add at least one provider API key/);
});

test('security headers are applied by default', async () => {
  const { app } = await loadAppWithEnv({ adminToken: 'secret-token', databaseUrl: undefined });

  const response = await request(app).get('/health').set('accept', 'application/json');

  assert.equal(response.status, 200);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-dns-prefetch-control'], 'off');
});

test('cors allowlist permits configured origin and preflight', async () => {
  const { app } = await loadAppWithEnv({
    adminToken: 'secret-token',
    databaseUrl: undefined,
    corsAllowedOrigins: 'https://console.example.com',
  });

  const preflight = await request(app)
    .options('/auth/me')
    .set('Origin', 'https://console.example.com');

  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'https://console.example.com');
  assert.equal(preflight.headers['access-control-allow-credentials'], 'true');
});

test('unknown API routes return JSON 404 instead of SPA html', async () => {
  const { app } = await loadAppWithEnv({ adminToken: 'secret-token', databaseUrl: undefined });

  const response = await request(app)
    .get('/api/does-not-exist')
    .set('x-admin-token', 'secret-token');

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'not_found');
});

