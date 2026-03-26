# OpenClaw Hosted Architecture (3-Plane)

This document reflects the current deployed model in this repository.

## 1) Planes and responsibilities

### Frontend plane

- Serves static assets from `public/`
- Primary responsibilities:
  - marketing/landing UI
  - health UI (`/health` when rendered as HTML)

### Control plane (`src/`)

Authoritative system of record and policy layer:

- authentication and user sessions
- per-user API key management (encrypted at rest)
- billing/subscription integration (Stripe)
- usage tracking and analytics persistence (Postgres)
- admin APIs and OpenAI-compatible routes
- internal data-plane/provisioning orchestration APIs

### Data plane (`services/data-plane/`)

Ingress and forwarding layer:

- accepts model/provisioning traffic
- forwards requests to control plane with `x-data-plane-token`
- keeps external data-plane API stable while control-plane internals evolve

---

## 2) Request paths

### Inference path

1. Client calls data plane (`/v1/infer`, `/v1/chat/completions`, `/v1/responses`) or control plane directly (`/api/llm/infer`, `/api/user/infer`)
2. Control plane validates auth/policy
3. Control plane invokes provider adapter (`openai`, `anthropic`, `gemini`)
4. Control plane stores usage + estimated cost in Postgres
5. Response returns to caller

### Provisioning path (node-pool request + lease)

1. Worker/system calls data plane provisioning endpoints
2. Data plane forwards to control plane internal provisioning APIs
3. Control plane creates/leases/updates provisioning request records
4. Status is queryable by request ID

---

## 3) Trust boundaries

- **External callers**: must use session auth or admin token depending on endpoint
- **Data plane -> control plane**: must present `x-data-plane-token`
- **Provider calls**: performed from control plane using configured provider credentials (or user BYOK)

---

## 4) Storage and dependencies

- **Postgres (required for full feature set)**
  - usage events and rollups
  - users/sessions/auth data
  - subscriptions and billing state
  - data-plane node state and provisioning requests
- **Redis (optional but recommended in multi-instance)**
  - distributed session store
  - distributed rate-limiting state

Fallback behavior exists for some Redis-backed capabilities (in-memory), but production deployments should use Redis.

---

## 5) Operational endpoints

### Control plane

- `GET /health`
- `GET /health.json`
- `GET /api/internal/data-plane/health`
- `GET /api/internal/data-plane/readiness`

### Data plane

- `GET /health`

---

## 6) Evolution notes

Current implementation includes node-pool provisioning request/lease APIs and data-plane forwarding endpoints.

The technical spec in `docs/node-pool-provisioning-spec.md` defines a broader future model (first-class pools/nodes, enrollment tokens, heartbeat lifecycle, richer routing). Treat that spec as roadmap + implementation guidance beyond current baseline.
