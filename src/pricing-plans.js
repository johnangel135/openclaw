'use strict';

const DEFAULT_CURRENCY = 'usd';

const DEFAULT_PLANS = [
  {
    id: 'starter',
    name: 'Starter (BYOK)',
    description: 'Hosted OpenClaw with your own model provider keys.',
    unit_amount: 2900,
    currency: DEFAULT_CURRENCY,
    interval: 'month',
    stripe_price_env: 'STRIPE_PRICE_STARTER',
    features: [
      '1 workspace',
      'Hosted runtime + dashboard',
      'Bring your own OpenAI/Anthropic/Gemini keys',
      'Provider usage billed directly by your model provider',
    ],
  },
  {
    id: 'pro',
    name: 'Pro (Managed)',
    description: 'Managed model access with included monthly token allowance.',
    unit_amount: 14900,
    currency: DEFAULT_CURRENCY,
    interval: 'month',
    stripe_price_env: 'STRIPE_PRICE_PRO',
    features: [
      '2 seats',
      '10M included monthly tokens',
      'Managed model access',
      'Token overage billing enabled',
    ],
  },
  {
    id: 'scale',
    name: 'Scale (Managed)',
    description: 'Higher-throughput managed deployment for growing teams.',
    unit_amount: 49900,
    currency: DEFAULT_CURRENCY,
    interval: 'month',
    stripe_price_env: 'STRIPE_PRICE_SCALE',
    features: [
      '5 workspaces',
      '10 seats',
      '60M included monthly tokens',
      'Priority support and scaling guidance',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Custom contract with security/compliance and dedicated support.',
    unit_amount: 0,
    currency: DEFAULT_CURRENCY,
    interval: 'month',
    stripe_price_env: 'STRIPE_PRICE_ENTERPRISE',
    features: [
      'Custom SSO and compliance requirements',
      'Dedicated environment options',
      'Commercial SLA and support',
    ],
  },
];

function getPricingPlans() {
  return DEFAULT_PLANS.map((plan) => {
    const stripePriceId = process.env[plan.stripe_price_env] || '';
    const purchasable = plan.id === 'enterprise' ? false : Boolean(stripePriceId);
    return {
      ...plan,
      stripe_price_id: stripePriceId || null,
      purchasable,
    };
  });
}

function getPlanById(planId) {
  if (!planId) return null;
  return getPricingPlans().find((plan) => plan.id === String(planId).trim().toLowerCase()) || null;
}

function getPlanByStripePriceId(stripePriceId) {
  if (!stripePriceId) return null;
  return getPricingPlans().find((plan) => plan.stripe_price_id === stripePriceId) || null;
}

module.exports = {
  getPricingPlans,
  getPlanById,
  getPlanByStripePriceId,
};
