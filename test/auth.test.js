'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

function loadAuthWithToken(token) {
  if (token === undefined) {
    delete process.env.CONSOLE_ADMIN_TOKEN;
  } else {
    process.env.CONSOLE_ADMIN_TOKEN = token;
  }

  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/auth')];

  return require('../src/auth');
}

function makeApp(middleware) {
  const app = express();
  app.get('/protected', middleware, (req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

test('requireAdminToken returns 503 when CONSOLE_ADMIN_TOKEN is missing', async () => {
  const { requireAdminToken } = loadAuthWithToken(undefined);
  const app = makeApp(requireAdminToken);

  const response = await request(app).get('/protected').set('accept', 'application/json');

  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, 'config_missing_admin_token');
});

test('requireAdminToken returns 401 when token is invalid', async () => {
  const { requireAdminToken } = loadAuthWithToken('secret-token');
  const app = makeApp(requireAdminToken);

  const response = await request(app).get('/protected').set('x-admin-token', 'wrong');

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'unauthorized');
});

test('requireAdminToken accepts x-admin-token, bearer token, and query token', async () => {
  const { requireAdminToken } = loadAuthWithToken('secret-token');
  const app = makeApp(requireAdminToken);

  const headerResponse = await request(app).get('/protected').set('x-admin-token', 'secret-token');
  assert.equal(headerResponse.status, 200);

  const bearerResponse = await request(app).get('/protected').set('authorization', 'Bearer secret-token');
  assert.equal(bearerResponse.status, 200);

  const queryResponse = await request(app).get('/protected?token=secret-token');
  assert.equal(queryResponse.status, 200);
});
