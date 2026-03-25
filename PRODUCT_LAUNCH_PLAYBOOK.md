# OpenClaw Cloud Product Launch Playbook

## Product Definition

**Offer:** Fully hosted OpenClaw bot platform.

Customers can choose:
1. **BYOK (Bring Your Own Model Key)** — customer adds provider keys (OpenAI/Anthropic/Gemini).
2. **Managed Models** — platform provides model access and bills usage by token.

## Target Positioning

"Production-ready OpenClaw bots in minutes — bring your own model keys or run fully managed with token-based billing."

---

## Packaging & Pricing (recommended)

## 1) Starter (BYOK)
- Price: **$29/month**
- Includes:
  - 1 bot/workspace
  - Hosted runtime + dashboard
  - Basic analytics/logs
  - Webhooks/integrations
- Billing: no model pass-through markup (customer key used directly)
- Limits: 1 seat, 50k requests/month soft cap

## 2) Pro (Managed)
- Price: **$149/month**
- Includes:
  - 1 production bot
  - 2 seats
  - 10M tokens/month included
  - Priority support
- Overage: **$12 per 1M input tokens**, **$24 per 1M output tokens** (example retail rates)
- Margin policy: keep 35–60% gross margin over blended provider cost

## 3) Scale
- Price: **$499/month**
- Includes:
  - 5 bots
  - 10 seats
  - 60M tokens included
  - Advanced analytics, SLA-lite
- Overage: tiered discounts by monthly volume

## 4) Enterprise
- Custom annual contract
- SSO/SAML, RBAC, audit exports, dedicated environment, support SLA

---

## Billing Architecture (Stripe)

Use hybrid billing:
1. **Subscription base fee** (monthly recurring)
2. **Metered usage** for managed-token overages

### Stripe Objects
- **Products**
  - `openclaw-starter-byok`
  - `openclaw-pro-managed`
  - `openclaw-scale-managed`
- **Prices**
  - recurring monthly prices for each plan
  - metered prices for:
    - `managed_input_tokens_million`
    - `managed_output_tokens_million`

### Metering Event Model
Store usage per request:
- tenant_id
- workspace_id
- model_provider
- model_name
- input_tokens
- output_tokens
- estimated_cost_usd
- timestamp

Aggregate hourly, submit to Stripe meter events in batches (fewer larger writes).

---

## Core System Design

## Multi-tenant isolation
- tenant-scoped API keys and usage records
- encryption at rest for BYOK keys
- strict per-tenant query filters in all usage/billing paths

## Cost controls (mandatory)
- hard spend cap per tenant/month
- per-minute request and token ceilings
- auto-throttle and auto-cutoff on cap breach
- anomaly alerting (spike detection)

## Security
- key encryption with rotation support
- redact secrets in logs
- audit trail for key add/remove/use
- signed webhooks + replay protection

## Reliability
- per-provider timeout/fallback policy
- retries with jitter for transient failures
- circuit breaker for unstable providers
- health dashboard + incident banner

---

## API Product Behavior

## BYOK path
- customer stores provider keys in encrypted vault
- inference requests routed with tenant key
- usage visible but provider billing stays with customer

## Managed path
- use platform-owned provider keys
- meter every token
- bill overage monthly via Stripe usage
- expose clear cost breakdown in dashboard

---

## Website Copy Pack (ready)

## Hero
**Hosted OpenClaw Bots for Teams**  
Launch production bots in minutes. Bring your own model keys or use fully managed models with token-based billing.

## Value bullets
- Production hosting with health and usage visibility
- BYOK for maximum control
- Managed models for zero-setup onboarding
- Token-level billing transparency

## CTA
- Primary: **Start Free Setup**
- Secondary: **Talk to Sales**

## Pricing section intro
Choose the model that fits your team: use your own provider keys, or let us run and meter models for you.

---

## Implementation Checklist (execution order)

1. Finalize pricing + legal terms
2. Add plan metadata to DB and API
3. Implement Stripe products/prices + webhook handling
4. Add usage meter aggregation job
5. Add spend caps + enforcement middleware
6. Add dashboard pages:
   - current plan
   - included tokens
   - overage forecast
7. Launch revised landing page pricing + FAQ
8. Run private beta with 5–10 customers
9. Tune pricing from real margin data

---

## KPI Targets (first 90 days)

- Activation rate (signup → first successful request): >45%
- Paid conversion: >8%
- Gross margin on managed plans: >40%
- Support tickets per active tenant: <0.4/month
- p95 inference gateway latency (excluding provider model time): <350ms

---

## Risk Controls

- Prevent abuse: per-IP + per-tenant rate limiting
- Avoid surprise bills: tenant budget guardrails + alert at 50/80/100%
- Reduce churn: clear dashboard cost estimates and predictable tiers
- Avoid underpricing: monthly margin review by model/provider
