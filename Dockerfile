# syntax=docker/dockerfile:1

# ── Build stage ───────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Copy dependency manifests and install production deps only
COPY package*.json ./
RUN npm ci --omit=dev

# ── Final stage ───────────────────────────────────────────────
FROM node:20-alpine AS final

# Security: run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy installed node_modules from build stage
COPY --from=build /app/node_modules ./node_modules

# Copy application source
COPY src/ ./src/
COPY public/ ./public/
COPY package.json ./

# Switch to non-root user
USER appuser

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
