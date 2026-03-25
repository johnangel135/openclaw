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

async function loadAppForPayments(env = {}, overrides = {}) {
  setEnv('CONSOLE_ADMIN_TOKEN', env.adminToken || 'admin-token');
  setEnv('DATABASE_URL', env.databaseUrl);
  setEnv('STRIPE_SECRET_KEY', env.stripeSecretKey);
  setEnv('STRIPE_WEBHOOK_SECRET', env.stripeWebhookSecret);
  setEnv('STRIPE_PRICE_STARTER', env.stripePriceStarter);
  setEnv('STRIPE_PRICE_PRO', env.stripePricePro);
  setEnv('STRIPE_CHECKOUT_MODE', env.stripeCheckoutMode || 'stub');
  setEnv('STRIPE_BILLING_PORTAL_RETURN_URL', env.portalReturnUrl);

  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/auth')];
  delete require.cache[require.resolve('../src/db')];
  delete require.cache[require.resolve('../src/payments')];
  delete require.cache[require.resolve('../src/pricing-plans')];
  delete require.cache[require.resolve('../src/providers')];
  delete require.cache[require.resolve('../src/rate-limit')];
  delete require.cache[require.resolve('../src/user-auth')];
  delete require.cache[require.resolve('../src/app')];

  const payments = require('../src/payments');
  Object.assign(payments, overrides);

  const { createApp } = require('../src/app');
  const userAuth = require('../src/user-auth');
  return { app: await createApp(), userAuth, payments };
}

test('payment readiness reports disabled when Stripe env vars are absent', async () => {
  const { app } = await loadAppForPayments({
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

test('checkout session endpoint returns payment stub in stub mode', async () => {
  const { app, userAuth } = await loadAppForPayments({
    stripeSecretKey: 'sk_test_123',
    stripeWebhookSecret: 'whsec_test_123',
    stripePriceStarter: 'price_starter_123',
    stripePricePro: 'price_pro_123',
    stripeCheckoutMode: 'stub',
  });

  const token = await userAuth.createSession({ id: 'u-pay-2', email: 'payer2@example.com' });
  const response = await request(app)
    .post('/api/user/payments/checkout-session')
    .set('Cookie', `openclaw_session=${token}`)
    .set('origin', 'http://127.0.0.1')
    .set('host', '127.0.0.1')
    .send({ plan_id: 'starter' });

  assert.equal(response.status, 202);
  assert.equal(response.body.checkout.provider, 'stripe');
  assert.equal(response.body.checkout.plan_id, 'starter');
  assert.equal(response.body.checkout.status, 'stub_not_submitted');
});

test('checkout session live mode sends metadata and returns checkout id/url', async () => {
  const originalFetch = global.fetch;
  let capturedBody;
  global.fetch = async (url, init) => {
    capturedBody = init.body;
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
    return {
      ok: true,
      json: async () => ({ id: 'cs_test_123', url: 'https://checkout.stripe.test/session/cs_test_123' }),
    };
  };

  try {
    const { app, userAuth } = await loadAppForPayments({
      stripeSecretKey: 'sk_test_123',
      stripeWebhookSecret: 'whsec_test_123',
      stripePriceStarter: 'price_starter_123',
      stripePricePro: 'price_pro_123',
      stripeCheckoutMode: 'live',
    });

    const token = await userAuth.createSession({ id: 'u-pay-3', email: 'payer3@example.com' });
    const response = await request(app)
      .post('/api/user/payments/checkout-session')
      .set('Cookie', `openclaw_session=${token}`)
      .set('origin', 'http://127.0.0.1')
      .set('host', '127.0.0.1')
      .send({ plan_id: 'starter' });

    assert.equal(response.status, 200);
    assert.equal(response.body.checkout.status, 'created');
    assert.equal(response.body.checkout.id, 'cs_test_123');

    const params = new URLSearchParams(capturedBody);
    assert.equal(params.get('metadata[user_id]'), 'u-pay-3');
    assert.equal(params.get('metadata[plan_id]'), 'starter');
    assert.equal(params.get('subscription_data[metadata][user_id]'), 'u-pay-3');
    assert.equal(params.get('subscription_data[metadata][plan_id]'), 'starter');
  } finally {
    global.fetch = originalFetch;
  }
});

test('stripe webhook signature verifier rejects tampered payload', async () => {
  const webhookSecret = 'whsec_test_signing_secret';
  const { payments } = await loadAppForPayments({
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

  const ok = payments.verifyStripeWebhookSignature(payload, `t=${timestamp},v1=${signature}`);
  assert.equal(ok.ok, true);

  const bad = payments.verifyStripeWebhookSignature(payload, `t=${timestamp},v1=deadbeef`);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'signature_mismatch');
});

test('webhook processor is idempotent and upserts subscriptions', async () => {
  const { payments } = await loadAppForPayments({
    stripeSecretKey: 'sk_test_123',
    stripeWebhookSecret: 'whsec_test_123',
  });

  const upserts = [];
  const deps = {
    recordPaymentEvent: async () => ({ inserted: true }),
    upsertUserSubscription: async (record) => {
      upserts.push(record);
      return record;
    },
  };

  const event = {
    id: 'evt_checkout_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_123',
        customer: 'cus_123',
        subscription: 'sub_123',
        metadata: { user_id: 'u1', plan_id: 'starter' },
      },
    },
  };

  const first = await payments.processStripeWebhookEvent(event, deps);
  assert.equal(first.statusCode, 200);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].user_id, 'u1');
  assert.equal(upserts[0].stripe_customer_id, 'cus_123');

  const duplicate = await payments.processStripeWebhookEvent(event, {
    ...deps,
    recordPaymentEvent: async () => ({ inserted: false }),
  });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.payload.duplicate, true);
  assert.equal(upserts.length, 1);
});

test('entitlement endpoint returns active state for authenticated user', async () => {
  const { app, userAuth } = await loadAppForPayments(
    {
      databaseUrl: 'postgres://not-used',
      stripeSecretKey: 'sk_test_123',
      stripeWebhookSecret: 'whsec_test_123',
    },
    {
      getUserEntitlement: async () => ({
        provider: 'stripe',
        status: 'active',
        active: true,
        plan_id: 'starter',
      }),
    },
  );

  const token = await userAuth.createSession({ id: 'u-ent-1', email: 'ent@example.com' });
  const response = await request(app)
    .get('/api/user/subscription')
    .set('Cookie', `openclaw_session=${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.entitlement.active, true);
  assert.equal(response.body.entitlement.plan_id, 'starter');
});

test('toEntitlement maps Stripe price ids to canonical plan ids when possible', async () => {
  const { payments } = await loadAppForPayments({
    stripeSecretKey: 'sk_test_123',
    stripeWebhookSecret: 'whsec_test_123',
    stripePriceStarter: 'price_starter_123',
    stripePricePro: 'price_pro_123',
  });

  const mapped = payments.toEntitlement({
    provider: 'stripe',
    status: 'active',
    stripe_price_id: 'price_pro_123',
    metadata: {},
  });
  assert.equal(mapped.plan_id, 'pro');

  const fallback = payments.toEntitlement({
    provider: 'stripe',
    status: 'active',
    stripe_price_id: 'price_unknown_123',
    metadata: {},
  });
  assert.equal(fallback.plan_id, 'price_unknown_123');
});

test('billing portal endpoint supports stub and mocked live flows', async () => {
  const stubAppData = await loadAppForPayments({
    databaseUrl: 'postgres://not-used',
    stripeSecretKey: 'sk_test_123',
    stripeWebhookSecret: 'whsec_test_123',
    stripeCheckoutMode: 'stub',
  }, {
    createStripeBillingPortalSession: async () => ({
      statusCode: 202,
      payload: { portal: { status: 'stub_not_submitted' } },
    }),
  });

  const stubToken = await stubAppData.userAuth.createSession({ id: 'u-bill-1', email: 'bill@example.com' });
  const stubResponse = await request(stubAppData.app)
    .post('/api/user/payments/billing-portal')
    .set('Cookie', `openclaw_session=${stubToken}`)
    .set('origin', 'http://127.0.0.1')
    .set('host', '127.0.0.1')
    .send({});

  assert.equal(stubResponse.status, 202);
  assert.equal(stubResponse.body.portal.status, 'stub_not_submitted');

  const liveAppData = await loadAppForPayments({
    databaseUrl: 'postgres://not-used',
    stripeSecretKey: 'sk_test_123',
    stripeWebhookSecret: 'whsec_test_123',
    stripeCheckoutMode: 'live',
  }, {
    createStripeBillingPortalSession: async () => ({
      statusCode: 200,
      payload: {
        portal: {
          status: 'created',
          id: 'bps_123',
          url: 'https://billing.stripe.test/session/bps_123',
        },
      },
    }),
  });

  const liveToken = await liveAppData.userAuth.createSession({ id: 'u-bill-2', email: 'bill2@example.com' });
  const liveResponse = await request(liveAppData.app)
    .post('/api/user/payments/billing-portal')
    .set('Cookie', `openclaw_session=${liveToken}`)
    .set('origin', 'http://127.0.0.1')
    .set('host', '127.0.0.1')
    .send({});

  assert.equal(liveResponse.status, 200);
  assert.equal(liveResponse.body.portal.status, 'created');
  assert.equal(liveResponse.body.portal.id, 'bps_123');
});
