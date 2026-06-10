# syntax=docker/dockerfile:1.7
#
# Multi-stage build for apps/api. Run from the monorepo root so workspace
# `workspace:*` deps resolve:
#
#   docker build -f apps/api/Dockerfile -t areyouagentic-api .

# ── 1. base — alpine + pnpm via corepack ─────────────────────────────────
FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN apk add --no-cache libc6-compat openssl tini \
 && corepack enable \
 && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

# ── 2. deps — install all workspace deps, cached on lockfile changes ─────
FROM base AS deps
# Copy only the manifests so Docker's layer cache survives source edits.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/analyzers/package.json packages/analyzers/
COPY packages/config/package.json packages/config/
RUN pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile

# ── 3. build — compile TypeScript and generate the prisma client ─────────
FROM deps AS build
COPY tsconfig.base.json turbo.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @areyouagentic/db exec prisma generate \
 && pnpm --filter @areyouagentic/api build

# ── 4. deploy — produce a self-contained, hoisted node_modules tree ──────
# pnpm deploy bundles the target package + its prod deps into one directory
# with a flat node_modules (no symlinks back to the workspace), which is
# exactly what we want to copy into a minimal runtime image.
FROM build AS deploy
RUN pnpm --filter @areyouagentic/api deploy --prod /out

# ── 5. runtime — minimal, non-root, dumb-init for clean shutdown ─────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    PORT=4000
RUN apk add --no-cache openssl tini wget \
 && addgroup -S app -g 1001 \
 && adduser -S app -G app -u 1001
WORKDIR /app

# /out is the deploy bundle: package.json + node_modules + the built dist.
COPY --from=deploy --chown=app:app /out ./
# Prisma client needs the schema at runtime for engine initialization.
COPY --from=build --chown=app:app /repo/packages/db/prisma ./prisma

USER app
EXPOSE 4000

# Hits the readiness check — fails if DB or Redis is unreachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --timeout=3 --spider http://127.0.0.1:${PORT}/health || exit 1

# tini reaps zombies and forwards signals — necessary for the API's graceful
# shutdown logic to actually fire when the orchestrator sends SIGTERM.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
