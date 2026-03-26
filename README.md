# 🌿 OpenClaw

> A beautiful, nature-inspired Node.js welcome page — containerised, CI/CD-ready, and always green.

[![CI](https://github.com/johnangel135/openclaw/actions/workflows/ci.yml/badge.svg)](https://github.com/johnangel135/openclaw/actions/workflows/ci.yml)
[![CD](https://github.com/johnangel135/openclaw/actions/workflows/cd.yml/badge.svg)](https://github.com/johnangel135/openclaw/actions/workflows/cd.yml)
[![Uptime](https://github.com/johnangel135/openclaw/actions/workflows/uptime.yml/badge.svg)](https://github.com/johnangel135/openclaw/actions/workflows/uptime.yml)
[![Release](https://github.com/johnangel135/openclaw/actions/workflows/release.yml/badge.svg)](https://github.com/johnangel135/openclaw/actions/workflows/release.yml)

## Overview

OpenClaw is a lightweight Express.js web application featuring:

- **Nature-inspired landing page** — forest green palette, animated leaf SVGs, Google Fonts (Playfair Display + Inter), fully responsive
- **Health page** at `/health` — responsive status UI for humans
- **Machine health JSON** at `/health.json` (or `/health?format=json`) — includes uptime and timestamp
- **Docker image** — multi-stage build, non-root user, minimal footprint
- **GitHub Actions CI** — lint → test → build → docker-build on every push/PR
- **GitHub Actions CD** — auto-publish to `ghcr.io/johnangel135/openclaw` on merge to `main`
- **Render redeploy trigger** — CD calls your Render deploy hook after image push
- **GitHub Auto Release** — publishes `v1.x.x` GitHub Releases on each `main` push and updates `CHANGELOG.md`
- **Uptime monitor** — GitHub Actions checks `/health` every 10 minutes
- **Node.js runtime pinned** — Node `20.x` via `engines` and `.nvmrc`
- **LLM Token & Cost Console** — protected `/console` dashboard with token/cost analytics
- **LLM proxy endpoints** — `/v1/chat/completions`, `/v1/responses`, `/api/llm/infer`
- **Postgres usage persistence** — stores request-level usage with 90-day default retention
- **Optional Redis production mode** — shared session store + distributed rate limiting with automatic in-memory fallback
- **Stripe subscriptions** — checkout, webhook processing, subscription persistence, entitlements, billing portal

## Quick Start

```bash
# Run locally
npm install
npm start
# → http://localhost:3000

# Run with Docker
docker pull ghcr.io/johnangel135/openclaw:latest
docker run -p 3000:3000 ghcr.io/johnangel135/openclaw:latest
```

### LLM Console Setup

Configure these environment variables before using the LLM proxy and `/console`:

```bash
DATABASE_URL=postgres://...
CONSOLE_ADMIN_TOKEN=your_admin_token
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
USAGE_RETENTION_DAYS=90

# Optional (recommended for multi-instance deployments)
REDIS_URL=redis://127.0.0.1:6379
REDIS_CONNECT_TIMEOUT_MS=3000
REDIS_KEY_PREFIX=openclaw:
```

You can start from `.env.example` and fill in real secrets.

Then open:

- `GET /auth/signup` (create account) or `GET /auth/login`
- `GET /console` (session-authenticated dashboard)
- `GET /api/user/usage/summary` (session cookie)
- `POST /api/user/infer` (session cookie + same-origin)

Admin-token routes remain available for service-to-service usage:

- `GET /api/usage/summary` (with `x-admin-token`)
- `POST /api/llm/infer` (with `x-admin-token`)

Control-plane ↔ data-plane internal routes use `x-data-plane-token` and require `DATA_PLANE_SHARED_TOKEN`:

- `GET /api/internal/data-plane/health`
- `GET /api/internal/data-plane/readiness`
- `POST /api/internal/data-plane/lease/request`
- `GET /api/internal/data-plane/lease/status/:requestId`
- `POST /api/internal/data-plane/lease/attach`
- `POST /api/internal/data-plane/lease/release/:requestId`
- `PUT /api/internal/data-plane/nodes/:nodeId/state`
- `GET /api/internal/data-plane/nodes/:nodeId`
- `GET /api/internal/data-plane/nodes`

### Payments Setup (Stripe)

Set payment env vars (test keys first):

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_BILLING_PORTAL_RETURN_URL=https://your-app.example.com/billing
```

Available payment endpoints:

- `GET /api/payments/readiness`
- `GET /api/payments/plans`
- `POST /api/user/payments/checkout-session` (requires login + same-origin)
- `POST /api/payments/webhook/stripe`
- `GET /api/user/subscription` (requires login)
- `POST /api/user/payments/billing-portal` (requires login + same-origin)

See `PAYMENTS.md` for details and security notes.

## Project Structure

```
├── src/
│   ├── app.js            # Main routes and middleware wiring
│   ├── auth.js           # Admin token extraction and guard middleware
│   ├── config.js         # Env configuration parsing
│   ├── console.html      # Protected analytics dashboard UI
│   ├── db.js             # Postgres init, analytics queries, retention purge
│   ├── providers.js      # OpenAI/Anthropic/Gemini adapters and usage extraction
│   ├── rate-limit.js     # Proxy/auth throttling (Redis optional, in-memory fallback)
│   └── index.js          # Bootstrap and server startup
├── public/
│   ├── index.html        # Landing page
│   └── health.html       # Human-friendly health dashboard
├── db/
│   └── migrations/
│       └── 001_llm_usage_console.sql
├── test/
│   ├── app-routes.test.js
│   ├── auth.test.js
│   ├── pricing.test.js
│   └── providers-usage.test.js
├── .github/
│   └── workflows/
│       ├── ci.yml        # CI pipeline
│       ├── cd.yml        # CD pipeline (GHCR push)
│       ├── release.yml   # GitHub release on every push
│       └── uptime.yml    # Scheduled /health checks
├── Dockerfile
├── .dockerignore
├── .env.example
├── .eslintrc.json
├── .nvmrc
├── CHANGELOG.md
└── package.json
```

## Docker Image

Images are published to the GitHub Container Registry:

```
ghcr.io/johnangel135/openclaw:latest
ghcr.io/johnangel135/openclaw:<git-sha>
```

## License

MIT
