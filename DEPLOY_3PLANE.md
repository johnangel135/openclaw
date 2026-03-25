# 3-Plane Deployment Guide (Frontend / Control Plane / Data Plane)

## What was prepared
- `services/data-plane/index.js` (inference-focused data plane)
- `render-3plane.yaml` (Render blueprint for 3 services)
- package scripts:
  - `npm run start:control-plane`
  - `npm run start:data-plane`

## Service responsibilities
- **Frontend** (`openclaw-frontend`): static `public/`
- **Control Plane** (`openclaw-control-plane`): auth, billing, tenancy, config, dashboard APIs
- **Data Plane** (`openclaw-data-plane`): high-throughput inference ingress and forwarding

## Deploy steps
1. Commit and push these changes.
2. In Render, create Blueprint using `render-3plane.yaml`.
3. Set secrets for control plane:
   - `DATABASE_URL`, `REDIS_URL`, `USER_KEYS_ENCRYPTION_KEY`
   - provider keys as needed
4. Set `CONTROL_PLANE_URL` for data plane to full URL, e.g.:
   - `https://openclaw-control-plane.onrender.com`
5. (Optional) DNS split:
   - `app.yourdomain.com` -> frontend
   - `api.yourdomain.com` -> control plane
   - `gateway.yourdomain.com` -> data plane

## Validation
- Frontend: `GET /` works
- Control plane: `GET /health` is `ok`
- Data plane: `GET /health` is `ok`
- Data plane inference:
  - `POST /v1/infer` forwards to control plane `/api/user/infer`

## Notes
- This is a production-ready split baseline for scaling and independent autoscaling.
- Next hardening step: move inference logic fully into data plane (instead of forwarding) and keep control plane purely orchestration/billing.
