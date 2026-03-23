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
- **GitHub Actions CI** — lint → build → docker-build on every push/PR
- **GitHub Actions CD** — auto-publish to `ghcr.io/johnangel135/openclaw` on merge to `main`
- **Render redeploy trigger** — CD calls your Render deploy hook after image push
- **GitHub Auto Release** — publishes `v1.x.x` GitHub Releases on each `main` push and updates `CHANGELOG.md`
- **Uptime monitor** — GitHub Actions checks `/health` every 10 minutes
- **Node.js runtime pinned** — Node `20.x` via `engines` and `.nvmrc`

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

## Project Structure

```
├── src/
│   └── index.js          # Express server
├── public/
│   └── index.html        # Landing page
├── .github/
│   └── workflows/
│       ├── ci.yml        # CI pipeline
│       ├── cd.yml        # CD pipeline (GHCR push)
│       ├── release.yml   # GitHub release on every push
│       └── uptime.yml    # Scheduled /health checks
├── Dockerfile
├── .dockerignore
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
