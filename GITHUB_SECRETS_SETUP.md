# GitHub Secrets Setup (required)

This repo now deploys all 3 Render services from CI using a single secret.

## Required secret

- `RENDER_API_KEY`

## Billing sync workflow secrets (hourly)

- `CONTROL_PLANE_SYNC_URL` (example: `https://openclaw-control-plane.onrender.com/api/usage/billing/sync`)
- `CONSOLE_ADMIN_TOKEN` (same token used for admin-protected API routes)

## Where to set it

GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Name: `RENDER_API_KEY`  
Value: your Render API key (starts with `rnd_...`)

## Verify

After saving the secret, push any commit to `main` and confirm workflow **CD** passes and triggers deploys for:
- `srv-d720r7paae7s73frcoj0` (frontend)
- `srv-d720r4aa214c73dkj35g` (control-plane)
- `srv-d720r18ule4c7385io30` (data-plane)
