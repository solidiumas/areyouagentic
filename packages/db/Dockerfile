# syntax=docker/dockerfile:1.7
#
# One-shot migration image: the Prisma CLI plus the committed migrations, and
# nothing else. The api/worker runtime images deliberately ship without the
# CLI, so schema changes reach production only through this image, run as the
# Azure Container Apps job `<prefix>-migrate` (see infra/apps.bicep and
# .github/workflows/deploy.yml). Run from the monorepo root:
#
#   docker build -f packages/db/Dockerfile -t areyouagentic-migrate .
#   docker run --rm -e DATABASE_URL=postgresql://… areyouagentic-migrate

FROM node:20-alpine
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN apk add --no-cache libc6-compat openssl tini \
 && corepack enable \
 && corepack prepare pnpm@9.12.0 --activate \
 && addgroup -S app -g 1001 \
 && adduser -S app -G app -u 1001
WORKDIR /repo

# The lockfile is workspace-wide, so every manifest has to be present for a
# frozen install even though only packages/db is installed.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/analyzers/package.json packages/analyzers/
COPY packages/config/package.json packages/config/
RUN pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile --filter @areyouagentic/db \
 && chown -R app:app /repo

COPY --chown=app:app packages/db/prisma packages/db/prisma

USER app
WORKDIR /repo/packages/db

ENTRYPOINT ["/sbin/tini", "--"]
# Applies pending migrations in order and exits non-zero on any failure, so a
# failed job execution blocks the rest of the deploy workflow.
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]
