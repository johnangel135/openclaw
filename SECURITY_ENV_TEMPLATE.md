# Secure Environment Template

Use this as a production baseline:

```env
PORT=3000
NODE_ENV=production

CONSOLE_ADMIN_TOKEN=REPLACE_WITH_LONG_RANDOM_TOKEN
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DB_NAME

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=

# 32-byte key in hex/base64 for user API key encryption
USER_KEYS_ENCRYPTION_KEY=REPLACE_WITH_64_HEX_CHARS

# Keep false for strict cert validation
PG_SSL_INSECURE_ALLOW=false
# If your DB uses private/self-signed CA, add one of these:
PG_CA_CERT=
PG_CA_CERT_BASE64=

# Comma-separated allowlists
ALLOWED_LLM_PROVIDERS=openai,anthropic,gemini
ALLOWED_LLM_MODELS=

# Payment provider secrets (Stripe)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_PRO=
STRIPE_SUCCESS_URL=
STRIPE_CANCEL_URL=
STRIPE_CHECKOUT_MODE=stub
STRIPE_WEBHOOK_TOLERANCE_SECONDS=300

USAGE_RETENTION_DAYS=90
PROXY_UPSTREAM_TIMEOUT_MS=30000
PROXY_RATE_LIMIT_MAX_REQUESTS=60
PROXY_RATE_LIMIT_WINDOW_MS=60000
```

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
