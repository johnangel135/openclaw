# Frontend Service

Deploy `public/` as a static site service.

Suggested routes:
- `/` -> landing
- `/health` -> static health dashboard shell (API calls go to control plane)
- `/auth` and `/console` should target the control-plane domain if server-rendered auth/session is required.

For strict separation in production:
- keep marketing pages here,
- keep authenticated console pages in control-plane domain.
