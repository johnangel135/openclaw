# OpenClaw

OpenClaw is a 3-plane LLM gateway platform built on Node.js + Express:

- **Frontend plane**: static web assets (`public/`)
- **Control plane**: auth, billing, usage tracking, admin APIs, orchestration (`src/`)
- **Data plane**: ingress/forwarder for inference and provisioning APIs (`services/data-plane/`)

It supports managed provider keys and BYOK-style per-user keys, OpenAI-compatible endpoints, usage analytics, and Stripe-backed subscription/billing flows.

---

## Architecture at a glance

```text
Clients
  │
  ├─> Frontend plane (static UI: /, /health)
  │
  └─> Data plane (high-throughput ingress)
         ├─ /v1/infer
         ├─ /v1/chat/completions
         ├─ /v1/responses
         └─ node-pool provisioning endpoints
                  │
                  ▼
          Control plane
         (auth, policy, usage, billing, DB, admin/internal APIs)
                  │
                  ├─ LLM providers (OpenAI/Anthropic/Gemini)
                  ├─ Postgres (usage, users, provisioning state)
                  └─ Redis (optional: distributed sessions + rate limits)
```

See `ARCHITECTURE_HOSTED_OPENCLAW.md` for the full hosted model.

---

## Repository structure

```text
openclaw/
├── public/                         # Frontend plane static assets
├── src/                            # Control plane
│   ├── app.js                      # Main routes + middleware
│   ├── db.js                       # Postgres schema/init + queries
│   ├── providers.js                # OpenAI/Anthropic/Gemini adapters
│   ├── payments.js                 # Stripe checkout/webhooks/metering
│   ├── user-auth.js                # Session auth + per-user API keys
│   └── node-pool-provisioning.js   # Provisioning request/lease lifecycle
├── services/
│   └── data-plane/
│       └── index.js                # Data plane ingress + CP forwarding
├── db/migrations/                  # SQL migrations
├── docs/
│   └── node-pool-provisioning-spec.md
├── render-3plane.yaml              # Render blueprint (3 services)
└── DEPLOY_3PLANE.md                # Deployment runbook
```

---

## Core capabilities

- OpenAI-compatible APIs: `/v1/chat/completions`, `/v1/responses`
- Unified infer API: `/api/llm/infer`, `/api/user/infer`, `/api/internal/infer`
- Session auth + per-user encrypted provider keys
- Usage/cost analytics with dashboard at `/console`
- Stripe subscriptions, checkout, billing portal, webhook handling, meter sync
- Data-plane lease + node state tracking APIs
- **Node-pool provisioning workflow** exposed via data plane for workers

---

## API surface (current)

### Public/system

- `GET /` — landing page
- `GET /health` — health page or JSON (`?format=json`)
- `GET /health.json` — machine health JSON

### Auth + user console

- `GET /auth/login`, `GET /auth/signup`
- `POST /api/auth/login`, `POST /api/auth/signup`, `POST /api/auth/logout`
- `GET /console` (session required)
- `GET /api/user/usage/summary` (session)
- `GET /api/user/api-keys`, `POST /api/user/api-keys` (session)

### Inference endpoints

- `POST /api/llm/infer` (**admin token**)
- `POST /api/user/infer` (**session auth**)
- `POST /api/internal/infer` (**data-plane token**)
- `POST /v1/chat/completions` (**admin token**)
- `POST /v1/responses` (**admin token**)

### Payments

- `GET /api/payments/readiness`
- `GET /api/payments/plans`
- `POST /api/user/payments/checkout-session` (session + same-origin)
- `POST /api/payments/webhook/stripe`
- `GET /api/user/subscription` (session)
- `POST /api/user/payments/billing-portal` (session + same-origin)

### Internal control-plane data-plane APIs
(Require header `x-data-plane-token` matching `DATA_PLANE_SHARED_TOKEN`.)

- `GET /api/internal/data-plane/health`
- `GET /api/internal/data-plane/readiness`
- `POST /api/internal/data-plane/lease/request`
- `GET /api/internal/data-plane/lease/status/:requestId`
- `POST /api/internal/data-plane/lease/attach`
- `POST /api/internal/data-plane/lease/release/:requestId`
- `PUT /api/internal/data-plane/nodes/:nodeId/state`
- `GET /api/internal/data-plane/nodes/:nodeId`
- `GET /api/internal/data-plane/nodes`

### Internal node-pool provisioning APIs
(Also protected by `x-data-plane-token`.)

- `POST /api/internal/node-pools/:nodePoolId/provisioning-requests`
- `POST /api/internal/node-pools/:nodePoolId/provisioning-requests/lease`
- `GET /api/internal/provisioning-requests/:requestId`
- `POST /api/internal/provisioning-requests/:requestId/status`

### Data-plane external forwarding endpoints

- `POST /v1/infer` -> CP `/api/internal/infer`
- `POST /v1/chat/completions` -> CP `/v1/chat/completions`
- `POST /v1/responses` -> CP `/v1/responses`
- `POST /v1/node-pools/:nodePoolId/provisioning-requests`
- `POST /v1/node-pools/:nodePoolId/provisioning-requests/lease`
- `GET /v1/provisioning-requests/:requestId`
- `POST /v1/provisioning-requests/:requestId/status`

---

## Quick start (local)

```bash
npm install
npm start
# http://localhost:3000
```

Minimum env for meaningful operation:

```bash
DATABASE_URL=postgres://...
CONSOLE_ADMIN_TOKEN=replace_with_long_random_token
OPENAI_API_KEY=...
# optional: ANTHROPIC_API_KEY, GEMINI_API_KEY
# optional: REDIS_URL
```

Start from `.env.example`.

---

## 3-plane deployment (Render)

Use `render-3plane.yaml` to create:

1. `openclaw-control-plane` (Node web service)
2. `openclaw-data-plane` (Node web service)
3. `openclaw-frontend` (static site)

Key wiring:

- Set `CONTROL_PLANE_URL` on data plane to the control-plane URL
- Set identical `DATA_PLANE_SHARED_TOKEN` on both CP and DP
- Set `DATABASE_URL` on control plane
- Optionally set `REDIS_URL` for distributed session/rate-limit storage

Full instructions: `DEPLOY_3PLANE.md`.

---

## Node-pool provisioning feature

OpenClaw now includes a node-pool provisioning request + lease lifecycle that can be consumed through the data plane (`/v1/node-pools/...` and `/v1/provisioning-requests/...`).

This provides:

- pool-scoped provisioning requests
- worker lease acquisition with TTL
- request status tracking and completion/failure reporting

Design/expansion roadmap (including richer pool/node identity model):
`docs/node-pool-provisioning-spec.md`.

---

## Security notes

- Admin APIs require `x-admin-token` (`CONSOLE_ADMIN_TOKEN`)
- Internal CP endpoints require `x-data-plane-token`
- Session-authenticated endpoints use secure cookie/session flow
- Same-origin checks protect mutating user billing/auth routes
- Optional CORS allowlist, provider/model allowlists, and security header toggles

---

## Scripts

```bash
npm start                 # control plane
npm run start:control-plane
npm run start:data-plane
npm test
npm run lint
npm run billing:sync-managed-usage
```

---

## License

MIT
