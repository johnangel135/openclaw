# Changelog

## v1.0.41 - 2026-03-25

- Managed launch baseline: internal data-plane auth, hosted pricing alignment, checkout UX pages (463de31)

## v1.0.40 - 2026-03-25

- Polish mobile nav: animation, click-outside close, active link highlight (62e4f52)

## v1.0.39 - 2026-03-25

- Improve mobile menu dropdown styling for cleaner professional nav (25f69ff)

## v1.0.38 - 2026-03-25

- Simplify CD to Render API deploys with single RENDER_API_KEY secret (30dd787)
- fix: make health page same-origin and add regression test (8a8e3a8)

## v1.0.37 - 2026-03-25

- Add static redirect pages for /login and /signup on frontend (aed844f)

## v1.0.36 - 2026-03-25

- Fix 3-plane routing and ops: route order, redirects, health source, multi-service CD/uptime (8064b6f)

## v1.0.35 - 2026-03-25

- Fix /console and /auth on static frontend with redirect pages (e961eb4)

## v1.0.34 - 2026-03-25

- Fix static frontend routes: redirect /console and /auth to control plane (a0361ef)

## v1.0.33 - 2026-03-25

- Add 3-plane architecture scaffold (frontend/control-plane/data-plane) and deployment blueprint (4c69a74)
- Validate usage request cursor before querying (6cd60e8)
- Align auth docs and normalize entitlement plan ids (9e2668b)
- Fix usage request limit cap to honor configured max (f8bb48d)
- Improve console API-key UX with explicit clear actions (fc23b5e)

## v1.0.32 - 2026-03-25

- Performance: compression, cache headers, system fonts, and free-tier Render blueprint (5a143f8)
- fix(payments): persist user metadata onto Stripe subscriptions (314af04)
- Improve API key save UX to avoid accidental key clearing (36aae9f)
- fix(api): return JSON 404 for unknown API routes (fd5eb31)

## v1.0.31 - 2026-03-24

- Apply remaining team fixes: dynamic plans, mobile nav, and plan-aware funnel (4ca0697)

## v1.0.30 - 2026-03-24

- Add sticky mobile action bar for console controls (a197840)

## v1.0.29 - 2026-03-24

- Complete P2 UX pass: mobile nav, responsive request table, key-save feedback (3002372)

## v1.0.28 - 2026-03-24

- Implement P0/P1 UX fixes: plan alignment, billing panel, CTA and auth a11y (064ff1a)
- Refine onboarding and trust-focused product copy across web flows (2dc84ba)
- test: add critical auth/payments flow QA coverage (9e72417)

## v1.0.27 - 2026-03-24

- Apply accessibility pass: contrast, focus states, skip links, reduced motion (7d45967)

## v1.0.26 - 2026-03-24

- Update Enterprise plan to 9/month unlimited access (24c47fa)

## v1.0.25 - 2026-03-24

- Fix subscription card ghost button contrast on light backgrounds (f64bf45)

## v1.0.24 - 2026-03-24

- Refocus homepage features on console token/cost analytics (96cebb2)

## v1.0.23 - 2026-03-24

- Add animated demos and console screenshot section to homepage (4dadcc1)

## v1.0.22 - 2026-03-24

- Replace stock feature photos with live product demo captures (8c9f5f5)

## v1.0.21 - 2026-03-24

- Revamp homepage features with demo gallery and subscription marketing (7fbd412)

## v1.0.20 - 2026-03-24

- Add dedicated auth routes and single-flow auth experience (b875d5c)

## v1.0.19 - 2026-03-24

- Refine auth UX to dedicated login/signup mode switch (bdcd354)

## v1.0.18 - 2026-03-24

- Implement Stripe subscription persistence, entitlements, and billing portal (1dfae8f)
- chore: include pending payment route updates in app wiring (ba6b905)
- feat: add optional redis-backed sessions and throttling with safe fallback (6c9a9f0)

## v1.0.17 - 2026-03-24

- Add DB CA TLS support and live Stripe checkout mode (d452006)

## v1.0.16 - 2026-03-24

- security: clamp usage request limits and document hardening envs (36b58a5)
- feat(payments): add Stripe readiness baseline with safe stubs and tests (7e166f3)
- Improve auth/console UX states and route coverage tests (7fa8b45)

## v1.0.15 - 2026-03-24

- Honor forwarded host/proto in CSRF same-origin checks (b2e9861)

## v1.0.14 - 2026-03-24

- Add secure environment template documentation (e2cb3e1)

## v1.0.13 - 2026-03-24

- Add allowlists, key encryption, and stricter DB TLS defaults (652dcc0)

## v1.0.12 - 2026-03-24

- Add auth throttling, CSRF checks, and secure cookies (247019c)
- Harden admin token handling (no query token) (e5150af)

## v1.0.11 - 2026-03-23

- fix(mobile): show console button in navbar on small screens (ecc1f97)

## v1.0.10 - 2026-03-23

- fix(auth): persist accounts in Postgres for container-safe signup (52e6162)

## v1.0.9 - 2026-03-23

- style(auth): match homepage visual theme (79f6981)

## v1.0.8 - 2026-03-23

- Add account auth and user API-key managed console access (73efbb3)

## v1.0.7 - 2026-03-23

- ci(cd): Roll back deployment trigger to Render (35aca95)

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
