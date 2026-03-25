# Render Deployment Latency Checklist

## 1) Commit and deploy Blueprint

```bash
git add render.yaml
git commit -m "Add Render blueprint tuned for lower latency"
git push origin main
```

Open in Render:

`https://dashboard.render.com/blueprint/new?repo=https://github.com/johnangel135/openclaw`

## 2) Fill required secrets before Apply

Set these in Render Dashboard:
- `DATABASE_URL`
- `USER_KEYS_ENCRYPTION_KEY`
- `CONSOLE_ADMIN_TOKEN` (or keep generated one)
- Provider keys you use: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`
- Stripe vars if billing is enabled

Optional but recommended:
- `REDIS_URL` (improves multi-instance consistency)

## 3) Keep service warm (important for latency)

Use **Starter or higher** plan (already set in render.yaml) to avoid sleep/cold starts.

## 4) Post-deploy validation

Check:
- `GET /health` returns `200`
- Landing page first byte time is stable (< 400ms typical)
- No startup errors in Render logs

Quick synthetic check:

```bash
curl -L -o /dev/null -s -w 'code=%{http_code} ttfb=%{time_starttransfer} total=%{time_total}\n' https://www.johntruong.it.com/
curl -L -o /dev/null -s -w 'code=%{http_code} ttfb=%{time_starttransfer} total=%{time_total}\n' https://www.johntruong.it.com/health
```

## 5) CDN/cache settings

In Cloudflare, add cache rules for public pages:
- `/`
- `/health` (HTML only)
- `/auth` (optional short cache for static shell only if compatible with auth behavior)

The app already sets short cache headers for public pages and compression on the server.

## 6) Ongoing monitoring

Track p95 latency and memory in Render metrics after deploy.
If p95 grows under traffic:
- upgrade plan
- add `REDIS_URL`
- evaluate a second instance (if session strategy supports it)
