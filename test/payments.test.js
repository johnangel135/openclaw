'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');

function setEnv(key, value) {
  if (value === undefined || value === null || value === '') {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function loadAppForPayments(env = {}) {
  setEnv('CONSOLE_ADMIN_TOKEN', env.adminToken || 'admin-token');
  setEnv('DATABASE_URL', env.databaseUrl);
  setEnv('STRIPE_SECRET_KEY', env.stripeSecretKey);
  setEnv('STRIPE_WEBHOOK_SECRET', env.stripeWebhookSecret);
  setEnv('STRIPE_PRICE_STARTER', env.stripePriceStarter);
  setEnv('STRIPE_PRICE_PRO', env.stripePricePro);

  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/auth')];
  delete require.cache[require.resolve('../src/db')];
  delete require.cache[require.resolve('../src/payments')];
  delete require.cache[require.resolve('../src/pricing-plans')];
  delete require.cache[require.resolve('../src/providers')];
  delete require.cache[require.resolve('../src/rate-limit')];
  delete require.cache[require.resolve('../src/user-auth')];
  delete require.cache[require.resolve('../src/app')];

  const { createApp } = require('../src/app');
  const userAuth = require('../src/user-auth');
  return { app: createApp(), userAuth };
}

test('payment readiness reports disabled when Stripe env vars are absent', async () => {
  const { app } = loadAppForPayments({
    stripeSecretKey: '',
    stripeWebhookSecret: '',
    stripePriceStarter: '',
    stripePricePro: '',
  });

  const response = await request(app).get('/api/payments/readiness');

  assert.equal(response.status, 200);
  assert.equal(response.body.enabled, false);
  assert.deepEqual(response.body.missing.sort(), ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']);
  assert.equal(Array.isArray(response.body.plans), true);
  assert.equal(response.body.plans[0].purchasable, false);
});

test('checkout session endpoint fails gracefully when payments are not configured', async () => {
  const { app, userAuth } = loadAppForPayments({
    stripeSecretKey: '',
    stripeWebhookSecret: '',
    stripePriceStarter: '',
    stripePricePro: '',
  });

  const token = userAuth.createSession({ id: 'u-pay-1', email: 'payer@example.com' });
  const response = await request(app)
    .post('/api/user/payments/checkout-session')
    .set('Cookie', `openclaw_session=${token}`)
    .set('origin', 'http://127.0.0.1')
    .set('host', '127.0.0.1')
    .send({ plan_id: 'starter' });

  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, 'payments_not_configured');
});

test('checkout session endpoint returns payment stub when configured', async () => {
  const { app, userAuth } = loadAppForPayments({
    stripeSecretKey: 'sk_test_123',
    stripeWebhookSecret: 'whsec_test_123',
    stripePriceStarter: 'price_starter_123',
    stripePricePro: 'price_pro_123',
  });

  const token = userAuth.createSession({ id: 'u-pay-2', email: 'payer2@example.com' });
  const response = await request(app)
    .post('/api/user/payments/checkout-session')
    .set('Cookie', `openclaw_session=${token}`)
    .set('origin', 'http://127.0.0.1')
    .set('host', '127.0.0.1')
    .send({ plan_id: 'starter' });

  assert.equal(response.status, 202);
  assert.equal(response.body.checkout.provider, 'stripe');
  assert.equal(response.body.checkout.plan_id, 'starter');
  assert.equal(response.body.checkout.stripe_price_id, 'price_starter_123');
  assert.equal(response.body.checkout.status, 'stub_not_submitted');
});

test('stripe webhook signature skeleton validates signed payload and rejects tampered payload', async () => {
  const webhookSecret = 'whsec_test_signing_secret';
  const { app } = loadAppForPayments({
    stripeSecretKey: 'sk_test_123',
    stripeWebhookSecret: webhookSecret,
    stripePriceStarter: 'price_starter_123',
    stripePricePro: 'price_pro_123',
  });

  const payload = JSON.stringify({ id: 'evt_123', type: 'checkout.session.completed' });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');

  const ok = await request(app)
    .post('/api/payments/webhook/stripe')
    .set('content-type', 'application/json')
    .set('stripe-signature', `t=${timestamp},v1=${signature}`)
    .send(payload);

  assert.equal(ok.status, 200);
  assert.equal(ok.body.received, true);

  const bad = await request(app)
    .post('/api/payments/webhook/stripe')
    .set('content-type', 'application/json')
    .set('stripe-signature', `t=${timestamp},v1=deadbeef`)
    .send(payload);

  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'signature_mismatch');
});
