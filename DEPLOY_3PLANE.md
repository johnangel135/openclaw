# Deploy OpenClaw in 3 Planes (Frontend / Control Plane / Data Plane)

This runbook is aligned with the current codebase and `render-3plane.yaml` blueprint.

## 1) What gets deployed

- **Frontend**: `openclaw-frontend` (Render static site)
- **Control plane**: `openclaw-control-plane` (Node web service, `npm run start:control-plane`)
- **Data plane**: `openclaw-data-plane` (Node web service, `npm run start:data-plane`)

## 2) Prerequisites

- Render account/project
- Postgres connection string for control plane (`DATABASE_URL`)
- Shared secret for CP/DP trust (`DATA_PLANE_SHARED_TOKEN`)
- At least one provider key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`)
- Optional Redis URL for distributed sessions/rate limits

## 3) Deploy via Render Blueprint

1. Push this repository to GitHub.
2. In Render, create a new **Blueprint** and select this repo.
3. Confirm the blueprint file: `render-3plane.yaml`.
4. Provision all 3 services.

## 4) Configure environment variables

### Control plane (`openclaw-control-plane`)

Required/important:

- `NODE_ENV=production`
- `PORT=10000`
- `TRUST_PROXY=true`
- `DATABASE_URL=...`
- `CONSOLE_ADMIN_TOKEN=...`
- `DATA_PLANE_SHARED_TOKEN=...`
- provider keys as needed (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`)

Recommended:

- `REDIS_URL=...`
- `USER_KEYS_ENCRYPTION_KEY=...`

### Data plane (`openclaw-data-plane`)

Required:

- `NODE_ENV=production`
- `PORT=10000`
- `CONTROL_PLANE_URL=https://<your-control-plane-host>`
- `DATA_PLANE_SHARED_TOKEN=<same value as control plane>`

### Frontend (`openclaw-frontend`)

- No runtime env required for static publish baseline.

## 5) Post-deploy validation

### Basic health

- Frontend: `GET /`
- Control plane: `GET /health`
- Data plane: `GET /health`

### Inference checks

- Data plane -> control plane forwarding:
  - `POST /v1/infer`
  - `POST /v1/chat/completions`
  - `POST /v1/responses`

### Provisioning checks (new node-pool flow)

Through data plane:

- `POST /v1/node-pools/:nodePoolId/provisioning-requests`
- `POST /v1/node-pools/:nodePoolId/provisioning-requests/lease`
- `GET /v1/provisioning-requests/:requestId`
- `POST /v1/provisioning-requests/:requestId/status`

## 6) Recommended domain split

- `app.yourdomain.com` -> frontend
- `api.yourdomain.com` -> control plane
- `gateway.yourdomain.com` -> data plane

## 7) Security and ops notes

- Keep `DATA_PLANE_SHARED_TOKEN` long/random and rotated periodically.
- Do not expose control-plane internal routes publicly without network controls.
- Use Redis in production for multi-instance session/rate-limit consistency.
- Keep Stripe webhooks pointed to control plane (`/api/payments/webhook/stripe`).

## 8) Troubleshooting quick hits

- **DP returns `control_plane_unreachable`**: verify `CONTROL_PLANE_URL` and network reachability.
- **CP internal APIs return `config_missing_data_plane_token`**: set `DATA_PLANE_SHARED_TOKEN` on CP.
- **Provisioning endpoints return `503 DATABASE_URL is not configured`**: configure CP Postgres.
- **Auth/session inconsistency across instances**: set Redis and `TRUST_PROXY=true`.
