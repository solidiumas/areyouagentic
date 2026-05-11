# syntax=docker/dockerfile:1.7
#
# Multi-stage build for apps/web (Next.js 15 App Router).
# Uses Next's `output: "standalone"` so the runtime image only needs Node +
# the bundled server.js — no pnpm, no source. Run from the monorepo root:
#
#   docker build -f apps/web/Dockerfile -t areyouagentic-web .
#
# Vercel is the recommended hosting; this image is for self-hosted setups
# (Docker Compose staging, Fly.io, k8s).

# ── 1. base ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN apk add --no-cache libc6-compat tini \
 && corepack enable \
 && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

# ── 2. deps — workspace install ──────────────────────────────────────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/analyzers/package.json packages/analyzers/
COPY packages/config/package.json packages/config/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile

# ── 3. build — produce .next/standalone ──────────────────────────────────
FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.base.json turbo.json ./
COPY packages packages
COPY apps/web apps/web
# Standalone output (next.config.ts) emits .next/standalone with a server.js
# plus the minimum node_modules needed to run it.
RUN pnpm --filter @areyouagentic/web build

# ── 4. runtime — minimal Node image, non-root user ───────────────────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache tini wget \
 && addgroup -S nextjs -g 1001 \
 && adduser -S nextjs -G nextjs -u 1001
WORKDIR /app

# .next/standalone contains the server bundle and a pruned node_modules
# pointing at all required packages. Static assets are copied separately
# because standalone doesn't include them.
COPY --from=build --chown=nextjs:nextjs /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nextjs /repo/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000

# Next.js answers / with a 200 once the server is ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --timeout=3 --spider http://127.0.0.1:${PORT}/ || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
# server.js is the standalone entry. It binds to HOSTNAME:PORT.
CMD ["node", "apps/web/server.js"]
