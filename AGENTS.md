# AGENTS.md

Operational context for this repository's Codex/GitHub/QNAP workflow.

## Repository

- Repo: `johnangel135/openclaw`
- Default branch: `main`
- Container image:
  - `ghcr.io/johnangel135/openclaw:latest`
  - `ghcr.io/johnangel135/openclaw:<git-sha>`

## CI/CD Model (Current)

- `CI` workflow validates code/tests/builds on push/PR.
- `CD` workflow only builds and pushes image to GHCR on push to `main`.
- QNAP deployment is handled by Watchtower (not GitHub runner deploy).

Source: `.github/workflows/cd.yml`

## QNAP Environment

- NAS LAN IP: `192.168.68.71`
- Gateway/LAN: `192.168.68.1` (Deco LAN)
- SSH user used: `hhdtruong`
- Main app container: `openclaw`
- Auto-update container: `watchtower-openclaw`

### QNAP Docker CLI Path

QNAP shell may not expose `docker` in PATH. Use:

`/share/CACHEDEV1_DATA/.qpkg/container-station/usr/bin/.libs/docker`

## Deployment Commands (QNAP)

### Run app manually

```bash
/share/CACHEDEV1_DATA/.qpkg/container-station/usr/bin/.libs/docker rm -f openclaw || true
/share/CACHEDEV1_DATA/.qpkg/container-station/usr/bin/.libs/docker pull ghcr.io/johnangel135/openclaw:latest
/share/CACHEDEV1_DATA/.qpkg/container-station/usr/bin/.libs/docker run -d --name openclaw --restart unless-stopped -p 3000:3000 ghcr.io/johnangel135/openclaw:latest
```

### Enable Watchtower auto-update (5 min poll)

```bash
/share/CACHEDEV1_DATA/.qpkg/container-station/usr/bin/.libs/docker rm -f watchtower-openclaw || true
/share/CACHEDEV1_DATA/.qpkg/container-station/usr/bin/.libs/docker run -d --name watchtower-openclaw --restart unless-stopped -v /var/run/docker.sock:/var/run/docker.sock containrrr/watchtower --interval 300 --cleanup openclaw
```

### Health checks

```bash
curl -fsS http://127.0.0.1:3000/health
/share/CACHEDEV1_DATA/.qpkg/container-station/usr/bin/.libs/docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"
/share/CACHEDEV1_DATA/.qpkg/container-station/usr/bin/.libs/docker logs --tail 50 openclaw
/share/CACHEDEV1_DATA/.qpkg/container-station/usr/bin/.libs/docker logs --tail 50 watchtower-openclaw
```

### Force one-time Watchtower check

```bash
/share/CACHEDEV1_DATA/.qpkg/container-station/usr/bin/.libs/docker run --rm -v /var/run/docker.sock:/var/run/docker.sock containrrr/watchtower --run-once --cleanup openclaw
```

## Known Notes

- `DATABASE_URL` is not configured in current runtime, so LLM usage tracking endpoints return `503` until DB env is set.
- Self-hosted GitHub runner approach on this NAS was unstable and intentionally replaced by Watchtower pull-based deploy.

## Security/Secrets Policy

- Do not store private keys, access tokens, or plaintext credentials in this repo.
- Keep secrets in GitHub repo secrets and/or QNAP runtime environment only.
