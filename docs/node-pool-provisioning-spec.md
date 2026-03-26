# OpenClaw Node-Pool Provisioning (CP + DP) — Technical Specification

**Status:** Proposed (implementation-ready)
**Date:** 2026-03-26
**Repo baseline:** `openclaw` with current 3-plane split (`src` = control plane, `services/data-plane` = data plane)

---

## 1) Context and goals

### Current baseline in this repo

- **Control Plane (CP):** `src/app.js` + `src/index.js`
  - Owns auth/session, billing, usage persistence, admin APIs, and internal `/api/internal/infer`
  - Stores data in Postgres (`src/db.js`)
- **Data Plane (DP):** `services/data-plane/index.js`
  - Stateless ingress that forwards inference requests to CP using `x-data-plane-token`
- **Shared trust primitive today:** `DATA_PLANE_SHARED_TOKEN`

### Problem

DP instances are currently homogeneous and unmanaged. There is no first-class concept of:

- node pools (grouping nodes by region/capability)
- node lifecycle/provisioning state
- selection/routing by pool
- enrollment and rotation beyond one global shared token

### Goals

Build a CP-driven node-pool provisioning system that:

1. Adds first-class **Node Pools** and **Nodes**
2. Enables secure **node enrollment/attestation**
3. Supports **stateful lifecycle** for pools and nodes
4. Allows CP to route requests to the right DP node/pool
5. Preserves existing CP/DP split and supports phased rollout with zero downtime

### Non-goals (v1)

- Kubernetes-native controllers/operator
- Autoscaling orchestration with cloud provider APIs
- Full mTLS PKI rollout in first milestone (designed for later extension)

---

## 2) High-level architecture

## 2.1 Components

### Control Plane additions (`src/*`)

- `src/node-pools/service.js` — core business logic
- `src/node-pools/store.js` — DB access
- `src/node-pools/routes-admin.js` — admin CRUD/provision APIs
- `src/node-pools/routes-internal.js` — DP enrollment/heartbeat APIs
- `src/node-pools/scheduler.js` — lease expiry, health timeout, reconciliation
- `src/node-pools/selection.js` — choose node for a request

### Data Plane additions (`services/data-plane/*`)

- `services/data-plane/agent.js` — enrollment + heartbeat worker
- Extend `services/data-plane/index.js`:
  - startup enroll call to CP
  - periodic heartbeat
  - readiness gating (do not serve if unenrolled/unhealthy)
  - include `x-node-id` and node auth token on CP-bound requests

## 2.2 Data flow summary

1. Admin creates pool in CP and mints short-lived **provisioning token**
2. DP bootstraps with token, calls CP enrollment endpoint
3. CP validates token, creates/updates node, returns **node auth token + lease**
4. DP heartbeats before lease expiry; CP renews lease
5. CP routes inference by selecting healthy node from target pool
6. If node misses heartbeat -> CP marks stale/unavailable

---

## 3) Data model and DB schema

Use PostgreSQL (consistent with existing `src/db.js`).

## 3.1 New tables

```sql
-- 003_node_pool_provisioning.sql

CREATE TABLE IF NOT EXISTS node_pools (
  id TEXT PRIMARY KEY,                       -- np_<uuid>
  name TEXT NOT NULL UNIQUE,
  environment TEXT NOT NULL DEFAULT 'prod', -- prod|staging|dev
  region TEXT,                               -- optional default region label
  routing_policy TEXT NOT NULL DEFAULT 'round_robin', -- round_robin|least_latency
  status TEXT NOT NULL DEFAULT 'active',     -- active|draining|paused|deleted
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pool_provision_tokens (
  id TEXT PRIMARY KEY,                       -- npt_<uuid>
  pool_id TEXT NOT NULL REFERENCES node_pools(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,           -- sha256(token)
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INTEGER,                          -- NULL = unlimited until expiry
  use_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',     -- active|revoked|expired
  created_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pool_nodes (
  id TEXT PRIMARY KEY,                       -- nn_<uuid>
  pool_id TEXT NOT NULL REFERENCES node_pools(id) ON DELETE CASCADE,
  display_name TEXT,
  region TEXT,
  zone TEXT,
  endpoint_url TEXT,                         -- optional for future DP->DP routing
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb, -- {models:[],providers:[],max_rps:n}
  status TEXT NOT NULL DEFAULT 'provisioning', -- provisioning|active|draining|cordoned|offline|revoked
  health_status TEXT NOT NULL DEFAULT 'unknown',  -- unknown|healthy|degraded|unhealthy
  last_heartbeat_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  node_auth_hash TEXT,                       -- hash of current node auth secret
  node_auth_rotated_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pool_node_events (
  id BIGSERIAL PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES pool_nodes(id) ON DELETE CASCADE,
  pool_id TEXT NOT NULL REFERENCES node_pools(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,                  -- enrolled|heartbeat_ok|lease_renewed|marked_offline|...
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pool_nodes_pool_status ON pool_nodes(pool_id, status);
CREATE INDEX IF NOT EXISTS idx_pool_nodes_lease_expires ON pool_nodes(lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_pool_nodes_heartbeat ON pool_nodes(last_heartbeat_at DESC);
CREATE INDEX IF NOT EXISTS idx_pool_node_events_node_created ON pool_node_events(node_id, created_at DESC);
```

## 3.2 Rationale

- `node_pools`: tenancy/routing boundary
- `pool_provision_tokens`: secure enrollment bootstrap with expiry + usage cap
- `pool_nodes`: operational state and liveness
- `pool_node_events`: audit trail and debugging

---

## 4) State machines

## 4.1 Pool state machine

States:

- `active` (default): enrollment and routing allowed
- `draining`: no new enrollments; existing nodes can serve until drained
- `paused`: no routing; enrollment blocked
- `deleted`: soft terminal state (no selection, tokens revoked)

Transitions:

- `active -> draining` (admin action)
- `draining -> paused` (admin action)
- `paused -> active` (admin action)
- any -> `deleted` (admin action, guarded)

Guards:

- `deleted` requires explicit force + no active leases unless `force=true`

## 4.2 Node state machine

States:

- `provisioning`: created via enrollment handshake, not yet ready
- `active`: healthy, routable
- `draining`: keepalive allowed, no new routing
- `cordoned`: admin-disabled but still heartbeat-capable
- `offline`: heartbeat timeout/lease expired
- `revoked`: auth revoked; must re-enroll

Transitions:

- `provisioning -> active` on first successful heartbeat + readiness
- `active -> draining` admin
- `draining -> active` admin rollback
- `active|draining|cordoned -> offline` lease/heartbeat timeout
- `offline -> active` valid re-heartbeat with unexpired auth/lease
- any -> `revoked` token rotation/revoke action
- `revoked -> provisioning` re-enrollment

Health dimension (`health_status`) updates independently: `unknown/healthy/degraded/unhealthy`.

---

## 5) API design

All endpoints remain in CP (`src/app.js`), mounted under explicit namespaces.

## 5.1 Admin APIs (require existing `requireAdminToken`)

### Create pool

`POST /api/admin/node-pools`

Request:
```json
{
  "name": "us-east-primary",
  "environment": "prod",
  "region": "us-east-1",
  "routing_policy": "round_robin",
  "metadata": {"tier":"gold"}
}
```

Response `201`:
```json
{ "pool": { "id":"np_...", "status":"active", "name":"us-east-primary" } }
```

### List pools

`GET /api/admin/node-pools?status=active&environment=prod`

### Update pool state/config

`PATCH /api/admin/node-pools/:poolId`

Supports status transitions + metadata/routing policy updates.

### Mint provisioning token

`POST /api/admin/node-pools/:poolId/provision-tokens`

Request:
```json
{
  "ttl_seconds": 1800,
  "max_uses": 10,
  "metadata": {"issued_for":"render-group-a"}
}
```

Response includes **plain token once**:
```json
{
  "token": "npt_live_xxx",
  "token_id": "npt_...",
  "expires_at": "..."
}
```

### Revoke provisioning token

`POST /api/admin/node-pools/:poolId/provision-tokens/:tokenId/revoke`

### Node operations

- `GET /api/admin/node-pools/:poolId/nodes`
- `PATCH /api/admin/nodes/:nodeId` (status changes: draining/cordoned/revoked)
- `POST /api/admin/nodes/:nodeId/rotate-auth` (force re-auth)
- `GET /api/admin/nodes/:nodeId/events`

## 5.2 Internal DP enrollment APIs

Use dedicated auth (not admin token).

### Enroll node

`POST /api/internal/node-pools/enroll`

Headers:
- `x-provision-token: <plain token>`

Request:
```json
{
  "display_name": "dp-us-east-1a-03",
  "region": "us-east-1",
  "zone": "us-east-1a",
  "capabilities": {
    "providers": ["openai", "anthropic"],
    "models": ["gpt-5-mini", "claude-3-7-sonnet-latest"],
    "max_rps": 80
  },
  "metadata": {
    "instance_id": "i-abc",
    "build_sha": "..."
  }
}
```

Response `201`:
```json
{
  "node": {"id":"nn_...","pool_id":"np_...","status":"provisioning"},
  "node_auth_token": "nna_live_xxx",
  "lease_ttl_seconds": 60,
  "heartbeat_interval_seconds": 20
}
```

### Heartbeat + lease renewal

`POST /api/internal/node-pools/heartbeat`

Headers:
- `x-node-id: nn_...`
- `authorization: Bearer <node_auth_token>`

Request:
```json
{
  "health_status": "healthy",
  "inflight_requests": 3,
  "load_avg_1m": 0.42,
  "metadata": {"dp_version":"1.0.0"}
}
```

Response `200`:
```json
{
  "ok": true,
  "status": "active",
  "lease_expires_at": "...",
  "next_heartbeat_seconds": 20
}
```

### Optional: node self-drain acknowledgement

`POST /api/internal/node-pools/node-status`

Used when CP sets draining and DP confirms no new intake.

---

## 6) Routing/selection behavior

## 6.1 Initial policy (v1)

CP selects node from target pool using:

1. `pool.status == active`
2. node `status == active`
3. `health_status in (healthy,degraded)`
4. `lease_expires_at > now()`

Then choose by policy:

- `round_robin`: deterministic counter per pool (Redis preferred, in-memory fallback)
- `least_latency`: use recent moving average from heartbeat metadata

## 6.2 Integration point with existing inference path

- Existing DP ingress endpoints remain (`/v1/infer`, `/v1/chat/completions`, `/v1/responses`)
- In v1, CP still executes provider invocation (`runProxyAndTrack`) as today
- Node-pool provisioning is added first for **managed DP fleet health + identity**
- Future phase can switch to CP->DP dispatch for model execution without changing pool primitives

---

## 7) Security model

## 7.1 Token hierarchy

- **Provision token** (short-lived bootstrap, one-time/limited-use)
- **Node auth token** (rotatable, per-node secret for heartbeat/internal auth)
- Existing **admin token** remains for human/service admin actions

## 7.2 Storage and verification

- Never store plaintext tokens in DB
- Store `sha256(token)` hashes (`token_hash`, `node_auth_hash`)
- Compare via constant-time equality
- Return plaintext only at mint/enroll response time

## 7.3 Transport and endpoint hardening

- Internal endpoints under `/api/internal/node-pools/*`
- Enforce HTTPS in production (already expected by deployment)
- Add IP allowlist option for internal routes (env-configurable)
- Rate-limit enroll endpoint per IP and per token-id
- Audit log all sensitive actions into `pool_node_events` and existing `security-log`

## 7.4 Revocation and rotation

- Immediate revoke of provision token
- Node token rotation endpoint invalidates old token atomically
- Heartbeat with revoked token returns `401 node_revoked`

---

## 8) Failure handling and recovery

## 8.1 CP unavailable

- DP continues serving current behavior where possible
- Heartbeat failures use exponential backoff with jitter (max 60s)
- DP marks itself not-ready after lease expiry to avoid stale routing

## 8.2 DB unavailable

- CP internal node APIs return 503 with structured error
- No issuance of new leases when persistence unavailable

## 8.3 Token replay/abuse

- Provision token usage count increments transactionally
- Expired/revoked/exhausted tokens rejected (`401/403`)
- Emit security events

## 8.4 Split-brain / stale liveness

- CP scheduler runs every 10s:
  - `if lease_expires_at < now -> status=offline`
- Routing excludes offline nodes strictly

## 8.5 Idempotency

- Enrollment supports idempotency by stable fingerprint (`instance_id` in metadata + pool)
- Re-enroll same instance rotates node auth and returns same node ID where safe

---

## 9) Implementation plan (phased)

## Phase 0 — Schema + scaffolding

1. Add migration `db/migrations/003_node_pool_provisioning.sql`
2. Extend `src/db.js` init to ensure new tables/indexes
3. Add store/service modules + unit tests

## Phase 1 — Admin CRUD + token minting

1. Add `/api/admin/node-pools*` routes in CP
2. Add token lifecycle APIs
3. Add audit event writes

## Phase 2 — DP enrollment + heartbeat

1. Add internal CP endpoints `/api/internal/node-pools/enroll|heartbeat`
2. Update DP process startup:
   - if `NODE_POOL_PROVISION_TOKEN` configured -> enroll
   - start heartbeat loop
3. Add readiness guard in DP

## Phase 3 — Routing policy integration

1. Add selection module and pool-aware routing hooks
2. Expose node/pool operational metrics in health/admin APIs

## Phase 4 — Hardening

1. Token rotation automation
2. Optional IP allowlisting for internal endpoints
3. SLO alerts and dashboards

---

## 10) Config/env additions

## Control plane

- `NODE_POOL_HEARTBEAT_TIMEOUT_SECONDS` (default 60)
- `NODE_POOL_LEASE_TTL_SECONDS` (default 60)
- `NODE_POOL_HEARTBEAT_MIN_INTERVAL_SECONDS` (default 10)
- `NODE_POOL_ENROLL_RATE_LIMIT_PER_MIN` (default 30)
- `NODE_POOL_INTERNAL_IP_ALLOWLIST` (optional CSV)

## Data plane

- `NODE_POOL_PROVISION_TOKEN` (bootstrap secret)
- `NODE_POOL_ENROLL_URL` (default `${CONTROL_PLANE_URL}/api/internal/node-pools/enroll`)
- `NODE_POOL_HEARTBEAT_URL` (default `${CONTROL_PLANE_URL}/api/internal/node-pools/heartbeat`)
- `NODE_POOL_DISPLAY_NAME`
- `NODE_POOL_REGION`, `NODE_POOL_ZONE`

---

## 11) Observability

- CP metrics:
  - `node_pool_enroll_success_total`
  - `node_pool_enroll_fail_total`
  - `node_pool_heartbeat_total{status}`
  - `node_pool_nodes_active{pool_id}`
  - `node_pool_lease_expiry_total`
- DP metrics:
  - `dp_enrollment_state`
  - `dp_heartbeat_failures_total`
  - `dp_lease_seconds_remaining`

Structured logs include `pool_id`, `node_id`, `event_type`.

---

## 12) Backward compatibility

- Existing endpoints and `DATA_PLANE_SHARED_TOKEN` continue to work during rollout
- If node-pool env not configured, DP behaves exactly as current forwarder
- CP routes default to existing behavior unless pool routing is explicitly enabled

---

## 13) Acceptance criteria

## Functional

1. Admin can create/update/list pools and mint/revoke provision tokens.
2. DP can enroll using provision token and receive node auth + lease.
3. DP heartbeats renew lease; CP marks node `offline` after timeout.
4. CP can list nodes by pool with accurate state.
5. Node revocation immediately blocks further heartbeat/auth.

## Security

1. No plaintext provision/node auth tokens stored in DB.
2. Enrollment fails for expired/revoked/maxed tokens.
3. Internal APIs reject missing/invalid node auth with consistent errors.
4. All admin + internal lifecycle changes are auditable.

## Reliability

1. CP restart does not lose node/pool state.
2. DP network interruption recovers automatically (backoff + re-heartbeat/re-enroll).
3. Under 1k nodes heartbeat load, CP remains stable (no unbounded memory growth).

## Rollout

1. Feature flag allows canary pool in staging first.
2. Production rollout can proceed pool-by-pool without breaking legacy DP traffic.

---

## 14) Test plan (minimum)

- Unit tests:
  - token hashing/validation and expiry logic
  - state transitions and guards
  - routing selection filters/policies
- Integration tests:
  - enroll -> heartbeat -> lease renew -> timeout -> offline
  - token revoke + rotate behaviors
  - admin API auth and validation
- Load test:
  - synthetic 1k nodes heartbeating every 20s

---

## 15) Suggested code touchpoints

- `src/app.js`
  - mount new admin/internal routes
- `src/db.js`
  - add helpers for pools/nodes/tokens/events
- `services/data-plane/index.js`
  - invoke new enrollment agent and heartbeat loop
- `test/`
  - add `node-pools.*.test.js` suites

---

## 16) Future extensions (post-v1)

- mTLS between DP and CP internal APIs
- weighted routing and per-model capacity-aware scheduling
- autoscaling hooks (cloud or orchestrator signals)
- active health probes CP->DP instead of heartbeat-only model

---

This spec is intentionally aligned to the repo’s current CP/DP boundary: CP remains orchestration + persistence authority; DP remains edge ingress with newly managed identity/lifecycle via node-pool provisioning.
