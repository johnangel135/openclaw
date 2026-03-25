'use strict';

const crypto = require('crypto');

const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_WEBHOOK_TOLERANCE_SECONDS,
  STRIPE_SUCCESS_URL,
  STRIPE_CANCEL_URL,
  STRIPE_CHECKOUT_MODE,
  STRIPE_BILLING_PORTAL_RETURN_URL,
  STRIPE_METER_EVENT_INPUT_NAME,
  STRIPE_METER_EVENT_OUTPUT_NAME,
} = require('./config');
const { getPlanById, getPlanByStripePriceId } = require('./pricing-plans');
const {
  getManagedUsageForPeriod,
  getUserSubscription,
  recordPaymentEvent,
  recordStripeUsageSyncRun,
  upsertUserSubscription,
} = require('./db');

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
      'metadata[stripe_price_id]': plan.stripe_price_id,
      'subscription_data[metadata][user_id]': userId,
      'subscription_data[metadata][plan_id]': plan.id,
      'subscription_data[metadata][stripe_price_id]': plan.stripe_price_id,
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

function normalizeStripeStatus(status) {
  const value = String(status || '').toLowerCase();
  if (!value) return 'unknown';
  return value;
}

function isActiveSubscriptionStatus(status) {
  return ['active', 'trialing'].includes(String(status || '').toLowerCase());
}

function deriveSubscriptionRecordFromStripeObject(stripeObject, fallback = {}) {
  const metadata = stripeObject?.metadata || {};
  const itemPriceId = stripeObject?.items?.data?.[0]?.price?.id || null;

  return {
    user_id: metadata.user_id || stripeObject?.client_reference_id || fallback.user_id || null,
    provider: 'stripe',
    status: normalizeStripeStatus(stripeObject?.status || fallback.status || 'unknown'),
    stripe_customer_id: stripeObject?.customer || fallback.stripe_customer_id || null,
    stripe_subscription_id: stripeObject?.id || fallback.stripe_subscription_id || null,
    stripe_price_id: itemPriceId || fallback.stripe_price_id || null,
    current_period_end: stripeObject?.current_period_end
      ? new Date(Number(stripeObject.current_period_end) * 1000).toISOString()
      : fallback.current_period_end || null,
    cancel_at_period_end: Boolean(stripeObject?.cancel_at_period_end),
    metadata: {
      ...fallback.metadata,
      ...metadata,
      stripe_status: normalizeStripeStatus(stripeObject?.status),
    },
  };
}

async function processStripeWebhookEvent(event, deps = {}) {
  const recordEvent = deps.recordPaymentEvent || recordPaymentEvent;
  const upsertSubscription = deps.upsertUserSubscription || upsertUserSubscription;
  const eventId = String(event?.id || '').trim();
  const eventType = String(event?.type || '').trim();

  if (!eventId || !eventType) {
    return {
      statusCode: 400,
      payload: {
        error: {
          code: 'invalid_event_payload',
          message: 'Webhook event missing id or type',
        },
      },
    };
  }

  const recorded = await recordEvent({
    provider: 'stripe',
    eventId,
    eventType,
    payload: {
      id: event.id,
      type: event.type,
      created: event.created,
      data: event.data || {},
    },
  });

  if (!recorded.inserted) {
    return {
      statusCode: 200,
      payload: {
        received: true,
        duplicate: true,
      },
    };
  }

  const object = event?.data?.object || {};

  if (eventType === 'checkout.session.completed') {
    const userId = object?.metadata?.user_id || object?.client_reference_id || null;
    const stripeSubscriptionId = object?.subscription || null;
    const stripeCustomerId = object?.customer || null;
    const stripePriceId = object?.metadata?.stripe_price_id || null;

    if (userId) {
      await upsertSubscription({
        user_id: userId,
        provider: 'stripe',
        status: 'active',
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_price_id: stripePriceId,
        current_period_end: null,
        cancel_at_period_end: false,
        metadata: {
          user_id: userId,
          plan_id: object?.metadata?.plan_id || null,
          checkout_session_id: object?.id || null,
        },
      });
    }

    return {
      statusCode: 200,
      payload: {
        received: true,
        processed: true,
        event_type: eventType,
      },
    };
  }

  if (eventType === 'customer.subscription.updated' || eventType === 'customer.subscription.deleted') {
    const fallback = {
      user_id: object?.metadata?.user_id || null,
      status: eventType === 'customer.subscription.deleted' ? 'canceled' : 'unknown',
    };

    const record = deriveSubscriptionRecordFromStripeObject(object, fallback);
    if (eventType === 'customer.subscription.deleted') {
      record.status = 'canceled';
    }

    if (record.user_id) {
      await upsertSubscription(record);
    }

    return {
      statusCode: 200,
      payload: {
        received: true,
        processed: true,
        event_type: eventType,
      },
    };
  }

  return {
    statusCode: 200,
    payload: {
      received: true,
      ignored: true,
      event_type: eventType,
    },
  };
}

function toEntitlement(subscription) {
  if (!subscription) {
    return {
      provider: 'stripe',
      status: 'none',
      active: false,
      plan_id: null,
      current_period_end: null,
      cancel_at_period_end: false,
    };
  }

  const configuredPlan = getPlanByStripePriceId(subscription.stripe_price_id || '');

  return {
    provider: subscription.provider,
    status: subscription.status,
    active: isActiveSubscriptionStatus(subscription.status),
    plan_id: subscription.metadata?.plan_id || configuredPlan?.id || subscription.stripe_price_id || null,
    current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end).toISOString() : null,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
  };
}

async function getUserEntitlement(userId, deps = {}) {
  const loadSubscription = deps.getUserSubscription || getUserSubscription;
  const subscription = await loadSubscription(userId, 'stripe');
  return toEntitlement(subscription);
}

function meterQuantityForPlan(planId, meterType, rawQuantity) {
  const quantity = Number(rawQuantity || 0);
  const includedByPlan = {
    pro: 10_000_000,
    scale: 60_000_000,
  };

  const included = includedByPlan[String(planId || '').toLowerCase()] || 0;
  if (meterType === 'input') {
    return Math.max(0, quantity - included);
  }

  // Output tokens are billed fully as overage baseline for now.
  return Math.max(0, quantity);
}

async function sendStripeMeterEvent({
  eventName,
  stripeCustomerId,
  quantity,
  timestamp,
  idempotencyKey,
}) {
  const body = new URLSearchParams({
    event_name: eventName,
    identifier: idempotencyKey,
    timestamp: String(timestamp),
    'payload[stripe_customer_id]': stripeCustomerId,
    'payload[value]': String(quantity),
  });

  const response = await fetch('https://api.stripe.com/v1/billing/meter_events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    },
    body,
  });

  if (!response.ok) {
    const stripeBody = await response.text();
    throw new Error(`stripe_meter_event_failed:${response.status}:${stripeBody}`);
  }
}

async function syncManagedUsageToStripe({ from, to, dryRun = false }) {
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

  const usage = await getManagedUsageForPeriod(from, to);
  const periodStart = usage.from;
  const periodEnd = usage.to;
  const timestamp = Math.floor(new Date(periodEnd).getTime() / 1000);

  const results = [];

  for (const row of usage.rows) {
    const inputQty = meterQuantityForPlan(row.plan_id, 'input', row.input_tokens);
    const outputQty = meterQuantityForPlan(row.plan_id, 'output', row.output_tokens);

    for (const meter of [
      { type: 'input', event: STRIPE_METER_EVENT_INPUT_NAME, qty: inputQty },
      { type: 'output', event: STRIPE_METER_EVENT_OUTPUT_NAME, qty: outputQty },
    ]) {
      if (!meter.qty) {
        results.push({ user_id: row.user_id, meter: meter.type, quantity: 0, skipped: true });
        continue;
      }

      const idempotencyKey = `meter:${row.user_id}:${meter.type}:${periodStart}:${periodEnd}`;
      const insert = await recordStripeUsageSyncRun({
        userId: row.user_id,
        periodStart,
        periodEnd,
        meterType: meter.type,
        quantity: meter.qty,
        idempotencyKey,
      });

      if (!insert.inserted) {
        results.push({ user_id: row.user_id, meter: meter.type, quantity: meter.qty, duplicate: true });
        continue;
      }

      if (!dryRun) {
        await sendStripeMeterEvent({
          eventName: meter.event,
          stripeCustomerId: row.stripe_customer_id,
          quantity: meter.qty,
          timestamp,
          idempotencyKey,
        });
      }

      results.push({ user_id: row.user_id, meter: meter.type, quantity: meter.qty, sent: !dryRun });
    }
  }

  return {
    statusCode: 200,
    payload: {
      ok: true,
      from: periodStart,
      to: periodEnd,
      dry_run: Boolean(dryRun),
      processed: results,
    },
  };
}

async function createStripeBillingPortalSession({ userId, origin }, deps = {}) {
  const loadSubscription = deps.getUserSubscription || getUserSubscription;
  const fallbackOrigin = origin || 'http://localhost:3000';
  const returnUrl = STRIPE_BILLING_PORTAL_RETURN_URL || `${fallbackOrigin}/billing`;

  if (STRIPE_CHECKOUT_MODE === 'stub') {
    return {
      statusCode: 202,
      payload: {
        portal: {
          provider: 'stripe',
          status: 'stub_not_submitted',
          requires_provider_integration: true,
          return_url: returnUrl,
        },
      },
    };
  }

  if (!STRIPE_SECRET_KEY) {
    return {
      statusCode: 503,
      payload: {
        error: {
          code: 'payments_not_configured',
          message: 'Payments are not fully configured',
          missing: ['STRIPE_SECRET_KEY'],
        },
      },
    };
  }

  const subscription = await loadSubscription(userId, 'stripe');
  const customerId = subscription?.stripe_customer_id || null;
  if (!customerId) {
    return {
      statusCode: 409,
      payload: {
        error: {
          code: 'customer_not_found',
          message: 'No Stripe customer found for this user',
        },
      },
    };
  }

  try {
    const body = new URLSearchParams({
      customer: customerId,
      return_url: returnUrl,
    });

    const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
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
            code: 'stripe_billing_portal_failed',
            message: stripeBody?.error?.message || 'Stripe billing portal session failed',
          },
        },
      };
    }

    return {
      statusCode: 200,
      payload: {
        portal: {
          provider: 'stripe',
          status: 'created',
          id: stripeBody.id,
          url: stripeBody.url,
          return_url: returnUrl,
        },
      },
    };
  } catch {
    return {
      statusCode: 502,
      payload: {
        error: {
          code: 'stripe_billing_portal_unreachable',
          message: 'Stripe billing portal request failed',
        },
      },
    };
  }
}

module.exports = {
  createStripeBillingPortalSession,
  createStripeCheckoutSession,
  deriveSubscriptionRecordFromStripeObject,
  getPaymentReadiness,
  getUserEntitlement,
  isActiveSubscriptionStatus,
  parseStripeSignatureHeader,
  processStripeWebhookEvent,
  syncManagedUsageToStripe,
  toEntitlement,
  verifyStripeWebhookSignature,
};
