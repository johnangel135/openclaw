# 🌿 OpenClaw

> A beautiful, nature-inspired Node.js welcome page — containerised, CI/CD-ready, and always green.

[![CI](https://github.com/johnangel135/openclaw/actions/workflows/ci.yml/badge.svg)](https://github.com/johnangel135/openclaw/actions/workflows/ci.yml)
[![CD](https://github.com/johnangel135/openclaw/actions/workflows/cd.yml/badge.svg)](https://github.com/johnangel135/openclaw/actions/workflows/cd.yml)

## Overview

OpenClaw is a lightweight Express.js web application featuring:

- **Nature-inspired landing page** — forest green palette, animated leaf SVGs, Google Fonts (Playfair Display + Inter), fully responsive
- **Health endpoint** at `/health` — returns JSON with uptime and timestamp
- **Docker image** — multi-stage build, non-root user, minimal footprint
- **GitHub Actions CI** — lint → build → docker-build on every push/PR
- **GitHub Actions CD** — auto-publish to `ghcr.io/johnangel135/openclaw` on merge to `main`

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
│       └── cd.yml        # CD pipeline (GHCR push)
├── Dockerfile
├── .dockerignore
├── .eslintrc.json
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
