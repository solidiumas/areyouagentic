# syntax=docker/dockerfile:1.7
#
# Multi-stage build for apps/worker. Worker renders pages with Playwright,
# so the runtime image is the official Playwright base — it ships a
# pre-installed Chromium plus all the system fonts and shared libraries that
# would otherwise blow up the layer count to install ourselves.
#
# Run from the monorepo root:
#
#   docker build -f apps/worker/Dockerfile -t areyouagentic-worker .

# ── 1. base ──────────────────────────────────────────────────────────────
# node:20-bookworm-slim is binary-compatible with the Playwright base image,
# so the deps installed here resolve identically in the runtime stage. We
# build on Debian rather than Alpine because Playwright doesn't ship Chromium
# binaries linked against musl.
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl tini \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

# ── 2. deps — workspace install, cached on lockfile changes ──────────────
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

# ── 3. build ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json turbo.json ./
COPY packages packages
COPY apps/worker apps/worker
RUN pnpm --filter @areyouagentic/db exec prisma generate \
 && pnpm --filter @areyouagentic/worker build

# ── 4. deploy — self-contained tree for the runtime image ────────────────
FROM build AS deploy
RUN pnpm --filter @areyouagentic/worker deploy --prod --legacy /out

# ── 5. runtime — Playwright base, non-root, signal-safe ──────────────────
# The Playwright image is large (~1.5GB) — it bundles Chromium + Firefox +
# WebKit + every X font you've ever heard of. We get all of that for free.
# Pin the tag to the Playwright version the code expects so a rebuild can't
# silently pull a newer Chromium under us.
FROM mcr.microsoft.com/playwright:v1.48.2-jammy AS runtime
ENV NODE_ENV=production \
    HEALTH_PORT=4001 \
    # Tell Playwright not to download browsers at runtime; the base image ships them.
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini wget \
 && rm -rf /var/lib/apt/lists/* \
 && (getent group pwuser >/dev/null || groupadd --system --gid 1001 pwuser) \
 && (id -u pwuser >/dev/null 2>&1 || useradd --system --uid 1001 --gid pwuser --create-home pwuser)
WORKDIR /app

COPY --from=deploy --chown=pwuser:pwuser /out ./
COPY --from=build --chown=pwuser:pwuser /repo/packages/db/prisma ./prisma

USER pwuser

EXPOSE 4001

# Hits the in-process health server (apps/worker/src/lib/health.ts). Fails if
# either Postgres or Redis is unreachable, so the orchestrator can pull the
# instance out of rotation without it dropping jobs silently.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --timeout=3 --spider http://127.0.0.1:${HEALTH_PORT}/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
