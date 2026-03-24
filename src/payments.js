'use strict';

const crypto = require('crypto');

const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_WEBHOOK_TOLERANCE_SECONDS,
  STRIPE_SUCCESS_URL,
  STRIPE_CANCEL_URL,
  STRIPE_CHECKOUT_MODE,
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

function validateCheckoutInput({ planId }) {
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

  return { plan };
}

async function createStripeCheckoutSession({ userId, planId, customerEmail, origin }) {
  const validated = validateCheckoutInput({ planId });
  if (validated.statusCode) return validated;

  const { plan } = validated;
  const fallbackOrigin = origin || 'http://localhost:3000';
  const successUrl = STRIPE_SUCCESS_URL || `${fallbackOrigin}/billing/success`;
  const cancelUrl = STRIPE_CANCEL_URL || `${fallbackOrigin}/billing/cancel`;

  if (STRIPE_CHECKOUT_MODE === 'stub') {
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
          success_url: successUrl,
          cancel_url: cancelUrl,
        },
      },
    };
  }

  try {
    const body = new URLSearchParams({
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      'line_items[0][price]': plan.stripe_price_id,
      'line_items[0][quantity]': '1',
      client_reference_id: userId,
      customer_email: customerEmail || '',
      'metadata[user_id]': userId,
      'metadata[plan_id]': plan.id,
    });

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const stripeBody = await response.json();
    if (!response.ok) {
      return {
        statusCode: 502,
        payload: {
          error: {
            message: stripeBody?.error?.message || 'Stripe checkout session failed',
            code: 'stripe_checkout_failed',
          },
        },
      };
    }

    return {
      statusCode: 200,
      payload: {
        checkout: {
          provider: 'stripe',
          mode: 'subscription',
          status: 'created',
          id: stripeBody.id,
          url: stripeBody.url,
          plan_id: plan.id,
          stripe_price_id: plan.stripe_price_id,
        },
      },
    };
  } catch {
    return {
      statusCode: 502,
      payload: {
        error: {
          message: 'Stripe checkout request failed',
          code: 'stripe_checkout_unreachable',
        },
      },
    };
  }
}

module.exports = {
  createStripeCheckoutSession,
  getPaymentReadiness,
  parseStripeSignatureHeader,
  verifyStripeWebhookSignature,
};
