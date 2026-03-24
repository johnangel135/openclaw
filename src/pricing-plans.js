'use strict';

const DEFAULT_CURRENCY = 'usd';

const DEFAULT_PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    description: 'Good for individual prototyping and light automation.',
    unit_amount: 1900,
    currency: DEFAULT_CURRENCY,
    interval: 'month',
    stripe_price_env: 'STRIPE_PRICE_STARTER',
    features: [
      'Up to 50k monthly proxy tokens tracked',
      'Usage dashboard access',
      'Community support',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For production workloads that need higher limits.',
    unit_amount: 7900,
    currency: DEFAULT_CURRENCY,
    interval: 'month',
    stripe_price_env: 'STRIPE_PRICE_PRO',
    features: [
      'Up to 500k monthly proxy tokens tracked',
      'Priority support',
      'Expanded analytics windows',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited access for high-volume teams.',
    unit_amount: 9900,
    currency: DEFAULT_CURRENCY,
    interval: 'month',
    stripe_price_env: 'STRIPE_PRICE_ENTERPRISE',
    features: [
      'Unlimited access',
      'Security/compliance collaboration',
      'Dedicated onboarding + roadmap support',
    ],
  },
];

function getPricingPlans() {
  return DEFAULT_PLANS.map((plan) => {
    const stripePriceId = process.env[plan.stripe_price_env] || '';
    return {
      ...plan,
      stripe_price_id: stripePriceId || null,
      purchasable: Boolean(stripePriceId),
    };
  });
}

function getPlanById(planId) {
  if (!planId) return null;
  return getPricingPlans().find((plan) => plan.id === String(planId).trim().toLowerCase()) || null;
}

module.exports = {
  getPricingPlans,
  getPlanById,
};
