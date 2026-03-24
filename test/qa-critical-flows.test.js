'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

function setEnv(key, value) {
  if (value === undefined || value === null || value === '') {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

async function loadApp(overrides = {}) {
  setEnv('CONSOLE_ADMIN_TOKEN', 'admin-token');
  setEnv('STRIPE_SECRET_KEY', 'sk_test_123');
  setEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test_123');
  setEnv('STRIPE_PRICE_STARTER', 'price_starter_123');
  setEnv('STRIPE_PRICE_PRO', 'price_pro_123');
  setEnv('STRIPE_CHECKOUT_MODE', 'stub');

  if (overrides.databaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    setEnv('DATABASE_URL', overrides.databaseUrl);
  }

  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/auth')];
  delete require.cache[require.resolve('../src/db')];
  delete require.cache[require.resolve('../src/payments')];
  delete require.cache[require.resolve('../src/pricing-plans')];
  delete require.cache[require.resolve('../src/providers')];
  delete require.cache[require.resolve('../src/rate-limit')];
  delete require.cache[require.resolve('../src/user-auth')];
  delete require.cache[require.resolve('../src/app')];

  const userAuth = require('../src/user-auth');
  if (overrides.userAuth) {
    Object.assign(userAuth, overrides.userAuth);
  }

  const payments = require('../src/payments');
  if (overrides.payments) {
    Object.assign(payments, overrides.payments);
  }

  const { createApp } = require('../src/app');
  return { app: await createApp(), userAuth, payments };
}

test('auth signup/login/logout/me flow returns expected states', async () => {
  const users = new Map();

  const { app } = await loadApp({
    userAuth: {
      async createUser(email, password) {
        const safeEmail = String(email || '').trim().toLowerCase();
        if (!safeEmail || String(password || '').length < 8) {
          throw new Error('Email and password (8+ chars) are required');
        }
        if (users.has(safeEmail)) {
          throw new Error('User already exists');
        }
        const user = { id: `u-${users.size + 1}`, email: safeEmail, created_at: new Date().toISOString() };
        users.set(safeEmail, { user, password });
        return user;
      },
      async authenticateUser(email, password) {
        const record = users.get(String(email || '').trim().toLowerCase());
        if (!record || record.password !== password) return null;
        return record.user;
      },
    },
  });

  const signup = await request(app)
    .post('/auth/signup')
    .send({ email: 'qa@example.com', password: 'password123' });
  assert.equal(signup.status, 201);
  assert.equal(signup.body.user.email, 'qa@example.com');
  assert.match(signup.headers['set-cookie'][0], /openclaw_session=/);

  const duplicate = await request(app)
    .post('/auth/signup')
    .send({ email: 'qa@example.com', password: 'password123' });
  assert.equal(duplicate.status, 409);

  const invalidLogin = await request(app)
    .post('/auth/login')
    .send({ email: 'qa@example.com', password: 'wrong-pass' });
  assert.equal(invalidLogin.status, 401);

  const login = await request(app)
    .post('/auth/login')
    .send({ email: 'qa@example.com', password: 'password123' });
  assert.equal(login.status, 200);
  const sessionCookie = login.headers['set-cookie'][0].split(';')[0];

  const meAuthed = await request(app)
    .get('/auth/me')
    .set('Cookie', sessionCookie);
  assert.equal(meAuthed.status, 200);
  assert.equal(meAuthed.body.user.email, 'qa@example.com');

  const meLoggedOut = await request(app)
    .post('/auth/logout')
    .set('Cookie', sessionCookie)
    .set('origin', 'http://127.0.0.1')
    .set('host', '127.0.0.1')
    .send({});
  assert.equal(meLoggedOut.status, 200);

  const meAfterLogout = await request(app)
    .get('/auth/me')
    .set('Cookie', sessionCookie);
  assert.equal(meAfterLogout.status, 401);
});

test('console and billing/subscription endpoints enforce auth and request constraints', async () => {
  const { app, userAuth } = await loadApp({ databaseUrl: 'postgres://not-used' });
  const token = await userAuth.createSession({ id: 'u-flow-1', email: 'flow@example.com' });
  const sessionCookie = `openclaw_session=${token}`;

  const consoleLoggedOut = await request(app).get('/console');
  assert.equal(consoleLoggedOut.status, 302);
  assert.equal(consoleLoggedOut.headers.location, '/auth');

  const consoleAuthed = await request(app)
    .get('/console')
    .set('Cookie', sessionCookie);
  assert.equal(consoleAuthed.status, 200);

  const checkoutNoAuth = await request(app)
    .post('/api/user/payments/checkout-session')
    .set('origin', 'http://127.0.0.1')
    .set('host', '127.0.0.1')
    .send({ plan_id: 'starter' });
  assert.equal(checkoutNoAuth.status, 401);

  const checkoutNoOrigin = await request(app)
    .post('/api/user/payments/checkout-session')
    .set('Cookie', sessionCookie)
    .send({ plan_id: 'starter' });
  assert.equal(checkoutNoOrigin.status, 403);

  const checkoutAuthed = await request(app)
    .post('/api/user/payments/checkout-session')
    .set('Cookie', sessionCookie)
    .set('origin', 'http://127.0.0.1')
    .set('host', '127.0.0.1')
    .send({ plan_id: 'starter' });
  assert.equal(checkoutAuthed.status, 202);

  const billingNoAuth = await request(app)
    .post('/api/user/payments/billing-portal')
    .set('origin', 'http://127.0.0.1')
    .set('host', '127.0.0.1')
    .send({});
  assert.equal(billingNoAuth.status, 401);

  const billingNoOrigin = await request(app)
    .post('/api/user/payments/billing-portal')
    .set('Cookie', sessionCookie)
    .send({});
  assert.equal(billingNoOrigin.status, 403);

  const billingAuthed = await request(app)
    .post('/api/user/payments/billing-portal')
    .set('Cookie', sessionCookie)
    .set('origin', 'http://127.0.0.1')
    .set('host', '127.0.0.1')
    .send({});
  assert.equal(billingAuthed.status, 202);

  const subscriptionNoAuth = await request(app).get('/api/user/subscription');
  assert.equal(subscriptionNoAuth.status, 401);
});
