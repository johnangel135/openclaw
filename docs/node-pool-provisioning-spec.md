# Node-Pool Provisioning in OpenClaw

**Status:** Partially implemented (baseline live) + roadmap for expanded lifecycle
**Last updated:** 2026-03-26

This document covers:

1. What is implemented now in this repository
2. API contracts for the live provisioning workflow
3. Planned evolution toward richer pool/node lifecycle management

---

## 1) Current implementation (live)

OpenClaw currently supports a **pool-scoped provisioning request + lease workflow** backed by Postgres and exposed through both control-plane internal APIs and data-plane external APIs.

### Implemented components

- `src/node-pool-provisioning.js`
  - create provisioning request
  - acquire lease for a worker
  - read request by ID
  - update request status
- `src/app.js`
  - mounts internal provisioning endpoints
  - protects them with `x-data-plane-token`
- `src/db.js`
  - persistence for provisioning requests + indexes
- `services/data-plane/index.js`
  - external `/v1/...` forwarding wrappers for provisioning APIs

### Persistence model (current)

Provisioning state is stored in `node_pool_provisioning_requests` with key fields for:

- `node_pool_id`
- request lifecycle `status`
- `worker_id`
- lease window (`leased_until`)
- payload/result/error metadata

---

## 2) Live API surface

## 2.1 Control-plane internal APIs

All require header:

- `x-data-plane-token: <DATA_PLANE_SHARED_TOKEN>`

### Create provisioning request

`POST /api/internal/node-pools/:nodePoolId/provisioning-requests`

Body (example):

```json
{
  "requested_by": "autoscaler",
  "payload": {
    "region": "us-east-1",
    "instance_type": "c7g.large"
  }
}
```

Response: `201 { "request": ... }`

### Acquire lease

`POST /api/internal/node-pools/:nodePoolId/provisioning-requests/lease`

Body:

```json
{
  "worker_id": "worker-01",
  "lease_ttl_seconds": 120
}
```

Responses:

- `200 { "request": ... }` when a lease is granted
- `204` when no request is available

### Get request status

`GET /api/internal/provisioning-requests/:requestId`

Response: `200 { "request": ... }` or `404`

### Update request status

`POST /api/internal/provisioning-requests/:requestId/status`

Body (example):

```json
{
  "status": "succeeded",
  "worker_id": "worker-01",
  "result": { "node_id": "dp-42" }
}
```

Valid status values are enforced by control-plane logic; invalid status returns `400 invalid_status`.

## 2.2 Data-plane external APIs

These are pass-through wrappers to control-plane internal endpoints:

- `POST /v1/node-pools/:nodePoolId/provisioning-requests`
- `POST /v1/node-pools/:nodePoolId/provisioning-requests/lease`
- `GET /v1/provisioning-requests/:requestId`
- `POST /v1/provisioning-requests/:requestId/status`

This allows worker clients to integrate with data-plane URLs while control-plane internals remain private.

---

## 3) Security model (current)

- CP internal provisioning routes are gated by `x-data-plane-token`
- Token value is configured by `DATA_PLANE_SHARED_TOKEN`
- Data plane injects this header when forwarding
- Database is required (`DATABASE_URL`) for provisioning APIs

---

## 4) Operational behavior

- Lease requests are pool-scoped (`nodePoolId`)
- Worker claims are explicit via `worker_id`
- Lease TTL is configurable per request (bounded server-side)
- No-available-work path is efficient (`204 No Content`)
- Request status can be advanced with result/error metadata for auditability

---

## 5) Planned expansion (roadmap)

The next phase (already design-documented internally) expands from request/lease workflow to a full node fleet model:

- first-class `node_pools` and `pool_nodes` entities
- short-lived provisioning tokens and per-node auth tokens
- DP enrollment + periodic heartbeat APIs
- lease expiry scheduler and offline detection
- pool-aware routing policies (round-robin / latency-aware)
- richer admin APIs for draining, cordoning, revoking, rotating auth

This roadmap is intentionally compatible with the existing CP/DP split and can be rolled out incrementally.

---

## 6) Backward compatibility

- Existing inference APIs remain unchanged.
- Existing `DATA_PLANE_SHARED_TOKEN` trust model remains active.
- Provisioning feature can be adopted per node pool without affecting unrelated traffic.
