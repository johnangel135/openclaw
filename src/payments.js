'use strict';

const crypto = require('crypto');

const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_WEBHOOK_TOLERANCE_SECONDS,
  STRIPE_SUCCESS_URL,
  STRIPE_CANCEL_URL,
} = require('./config');
const { getPlanById } = require('./pricing-plans');

function getPaymentReadiness() {
  const missing = [];
  if (!STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (!STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET');

  return {
    enabled: missing.length === 0,
    missing,
  };
}

function parseStripeSignatureHeader(value) {
  if (!value) return null;
  const entries = String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  let timestamp = null;
  const signatures = [];

  for (const entry of entries) {
    const [key, signedValue] = entry.split('=');
    if (key === 't') timestamp = signedValue;
    if (key === 'v1') signatures.push(signedValue);
  }

  if (!timestamp || signatures.length === 0) {
    return null;
  }

  return { timestamp, signatures };
}

function verifyStripeWebhookSignature(rawBody, signatureHeader) {
  if (!STRIPE_WEBHOOK_SECRET) {
    return { ok: false, reason: 'webhook_secret_missing' };
  }

  const parsed = parseStripeSignatureHeader(signatureHeader);
  if (!parsed) {
    return { ok: false, reason: 'invalid_signature_header' };
  }

  const timestamp = Number.parseInt(parsed.timestamp, 10);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: 'invalid_signature_timestamp' };
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (ageSeconds > STRIPE_WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'signature_too_old' };
  }

  const payloadBuffer = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody || {}));

  const signedPayload = `${timestamp}.${payloadBuffer.toString('utf8')}`;
  const expected = crypto
    .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
    .update(signedPayload, 'utf8')
    .digest('hex');

  const expectedBuffer = Buffer.from(expected, 'hex');
  const match = parsed.signatures.some((sig) => {
    const sigBuffer = Buffer.from(sig, 'hex');
    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  });

  if (!match) {
    return { ok: false, reason: 'signature_mismatch' };
  }

  return { ok: true, eventTimestamp: timestamp };
}

function buildCheckoutSessionStub({ userId, planId, customerEmail, origin }) {
  const readiness = getPaymentReadiness();
  if (!readiness.enabled) {
    return {
      statusCode: 503,
      payload: {
        error: {
          message: 'Payments are not fully configured',
          code: 'payments_not_configured',
          missing: readiness.missing,
        },
      },
    };
  }

  const plan = getPlanById(planId);
  if (!plan) {
    return {
      statusCode: 400,
      payload: {
        error: {
          message: 'Unknown pricing plan',
          code: 'unknown_plan',
        },
      },
    };
  }

  if (!plan.stripe_price_id) {
    return {
      statusCode: 409,
      payload: {
        error: {
          message: 'Plan is not mapped to a Stripe price ID',
          code: 'plan_not_purchasable',
        },
      },
    };
  }

  const fallbackOrigin = origin || 'http://localhost:3000';
  return {
    statusCode: 202,
    payload: {
      checkout: {
        provider: 'stripe',
        mode: 'subscription',
        status: 'stub_not_submitted',
        requires_provider_integration: true,
        user_id: userId,
        customer_email: customerEmail || null,
        plan_id: plan.id,
        stripe_price_id: plan.stripe_price_id,
        success_url: STRIPE_SUCCESS_URL || `${fallbackOrigin}/billing/success`,
        cancel_url: STRIPE_CANCEL_URL || `${fallbackOrigin}/billing/cancel`,
      },
    },
  };
}

module.exports = {
  buildCheckoutSessionStub,
  getPaymentReadiness,
  parseStripeSignatureHeader,
  verifyStripeWebhookSignature,
};
