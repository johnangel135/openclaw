# Changelog

## v1.0.6 - 2026-03-23

- revert(docs): Remove AGENTS.md from repository (ed2806d)

## v1.0.5 - 2026-03-23

- docs: Add AGENTS.md with QNAP and GitHub ops context (c326307)

## v1.0.4 - 2026-03-23

- ci(cd): Use GHCR publish with QNAP watchtower auto-deploy (9ea9c07)

## v1.0.3 - 2026-03-23

- ci(cd): Deploy on self-hosted QNAP runner (b0ab6d9)

## v1.0.2 - 2026-03-23

- ci(cd): Deploy latest image to QNAP via SSH (74c22c0)

## v1.0.1 - 2026-03-23

- Implement LLM token and cost console with provider proxy (dbee1b5)

## v1.0.0 - 2026-03-23

- Use v1.x.x auto releases with changelog updates (6592f6a)
- Trigger Render redeploy after successful CD build (48dd3ed)
- Add GitHub auto-release workflow for every push (f7f0110)
- Add homepage-styled health dashboard with live metrics (8ca7ad4)
- Harden secrets handling and add uptime monitoring (b36be2e)
- Add package-lock.json for npm ci builds (7a5f2e1)
- feat: add Node.js welcome app with Docker and GitHub Actions CI/CD (41e0264)
- Initial commit (cf657b2)

All notable changes to this project will be documented in this file.

## Unreleased

- Added LLM proxy endpoints: `POST /v1/chat/completions`, `POST /v1/responses`, and `POST /api/llm/infer`.
- Added protected analytics APIs under `/api/usage/*` and a protected `/console` dashboard.
- Added Postgres-backed usage storage, model pricing seed data, and 90-day retention purge scheduling.
- Added provider adapters for OpenAI, Anthropic, and Gemini with normalized usage extraction.
- Added admin token authentication, proxy rate limiting, and upstream timeout/error handling.
- Added tests for provider usage extraction, pricing logic, auth middleware, and protected route behavior.
