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
- **QNAP auto-update** — Watchtower on QNAP pulls new `latest` image and restarts automatically
- **GitHub Auto Release** — publishes `v1.x.x` GitHub Releases on each `main` push and updates `CHANGELOG.md`
- **Uptime monitor** — GitHub Actions checks `/health` every 10 minutes
- **Node.js runtime pinned** — Node `20.x` via `engines` and `.nvmrc`
- **LLM Token & Cost Console** — protected `/console` dashboard with token/cost analytics
- **LLM proxy endpoints** — `/v1/chat/completions`, `/v1/responses`, `/api/llm/infer`
- **Postgres usage persistence** — stores request-level usage with 90-day default retention

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
```

You can start from `.env.example` and fill in real secrets.

Then open:

- `GET /console?token=<CONSOLE_ADMIN_TOKEN>`
- `GET /api/usage/summary` (with `x-admin-token`)
- `POST /api/llm/infer` (with `x-admin-token`)

## Project Structure

```
├── src/
│   ├── app.js            # Main routes and middleware wiring
│   ├── auth.js           # Admin token extraction and guard middleware
│   ├── config.js         # Env configuration parsing
│   ├── console.html      # Protected analytics dashboard UI
│   ├── db.js             # Postgres init, analytics queries, retention purge
│   ├── providers.js      # OpenAI/Anthropic/Gemini adapters and usage extraction
│   ├── rate-limit.js     # In-memory proxy request limiter
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

## QNAP Auto Deploy

This project now deploys to QNAP without a self-hosted runner:

1. GitHub CD publishes `ghcr.io/johnangel135/openclaw:latest`
2. QNAP runs the `openclaw` container
3. QNAP `watchtower-openclaw` checks every 5 minutes and auto-updates `openclaw`

## License

MIT
