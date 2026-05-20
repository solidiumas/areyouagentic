# areyouagentic.com

Monorepo for [areyouagentic.com](https://areyouagentic.com).

## Stack

- **pnpm** workspaces + **Turborepo** for orchestration
- **TypeScript 5.x** in strict mode
- **Node 20+**
- **Next.js** (`apps/web`), **Fastify** (`apps/api`), **BullMQ** (`apps/worker`)
- **Prisma** + **Postgres 16** (`packages/db`)
- **Redis 7** for job queues

## Layout

```
areyouagentic/
├── apps/
│   ├── web/        # Next.js frontend
│   ├── api/        # Fastify API server
│   └── worker/     # BullMQ workers
├── packages/
│   ├── analyzers/  # Core analysis modules (reused by worker)
│   ├── db/         # Prisma schema + client
│   ├── shared/     # Shared types, Zod schemas, constants
│   └── config/     # Shared eslint, tsconfig, prettier config
├── .github/workflows/
├── turbo.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── docker-compose.yml
```

## Getting started

### 1. Prerequisites

- **Node.js 20+** (a `.nvmrc` is provided — `nvm use`)
- **pnpm 9+** (`npm install -g pnpm` or `corepack enable`)
- **Docker** (for local Postgres + Redis)

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in secrets (Anthropic API key, R2 credentials, app
secrets). The Postgres and Redis URLs already match the bundled
`docker-compose.yml`.

Generate strong session/JWT secrets:

```bash
openssl rand -base64 32
```

### 4. Start local infrastructure

```bash
docker compose up -d
```

This starts:

- **Postgres 16** on `localhost:5432` (user/pass/db: `areyouagentic`)
- **Redis 7** on `localhost:6379`

Stop and remove with `docker compose down` (add `-v` to also wipe volumes).

### 5. Run dev mode

```bash
pnpm dev
```

Turborepo will start all apps that have a `dev` script in parallel.

## Common scripts

| Command             | What it does                               |
| ------------------- | ------------------------------------------ |
| `pnpm dev`          | Run all apps in dev mode                   |
| `pnpm build`        | Build everything (Turbo handles dep order) |
| `pnpm lint`         | ESLint across the monorepo                 |
| `pnpm typecheck`    | `tsc --noEmit` in every workspace          |
| `pnpm test`         | Run all test suites                        |
| `pnpm format`       | Prettier write                             |
| `pnpm format:check` | Prettier check (used in CI)                |
| `pnpm clean`        | Remove build artifacts and `node_modules`  |

To run a script in a single workspace:

```bash
pnpm --filter @areyouagentic/web dev
pnpm --filter @areyouagentic/api build
```

## Configuration

- **TypeScript:** every workspace extends `tsconfig.base.json` (strict
  mode) via one of the presets in `packages/config/tsconfig`.
- **ESLint:** flat configs in `packages/config/eslint` —
  apps and packages re-export `base`, `node`, or `next`.
- **Prettier:** single shared config at `packages/config/prettier`.

## Observability

- **Structured JSON logs** everywhere. `apps/api` and `apps/worker` use
  `pino`; in production both emit JSON to stdout. `apps/web` emits JSON
  through a small helper (`apps/web/src/lib/logger.ts`) so the Edge runtime
  works the same way as Node.
- **Request ID** propagates end-to-end:
  1. `apps/web` mints `x-request-id` in middleware and on every API fetch.
  2. `apps/api` accepts the incoming id (or mints one) and echoes it on
     every response.
  3. The API attaches the id to BullMQ payloads; the worker logs it on
     every job line. Search a single id and you'll get the whole flow.
- **Sentry** in all three apps, opt-in via `SENTRY_DSN` /
  `NEXT_PUBLIC_SENTRY_DSN`. `beforeSend` strips Authorization, Cookie,
  request bodies, IPs, emails, and query strings before events leave the
  process.
- **Health endpoints:**
  - API: `GET /health` (fans out to Postgres + Redis).
  - Worker: `GET :4001/health` and `:4001/ready` from an in-process
    `node:http` server.
- **Metrics:** `GET /api/metrics`, gated behind HTTP basic auth
  (`METRICS_USERNAME` / `METRICS_PASSWORD`). Returns JSON with
  jobs-by-status in the last hour, duration percentiles, error rate, and
  an LLM-token placeholder until the analyzer wires up real Anthropic
  calls.

## Docker

Three Dockerfiles, each a multi-stage build that copies a self-contained
`pnpm deploy` tree into a minimal runtime image, runs as a non-root user,
and ships a `HEALTHCHECK`:

| App      | Base image                                                     | Approx size |
| -------- | -------------------------------------------------------------- | ----------- |
| `web`    | `node:20-alpine` (Next.js standalone)                          | ~150 MB     |
| `api`    | `node:20-alpine` + prisma engines                              | ~200 MB     |
| `worker` | `mcr.microsoft.com/playwright:v1.48.2-jammy` (Chromium + Node) | ~1.6 GB     |

Build the whole stack locally:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.staging up -d --build
docker compose -f docker-compose.prod.yml exec api \
  pnpm --filter @areyouagentic/db prisma migrate deploy
```

Or build one image at a time, **from the monorepo root**:

```bash
docker build -f apps/api/Dockerfile    -t areyouagentic-api    .
docker build -f apps/worker/Dockerfile -t areyouagentic-worker .
docker build -f apps/web/Dockerfile    -t areyouagentic-web    .
```

## CI / CD

| Workflow                                         | Trigger                          | Job                                                                   |
| ------------------------------------------------ | -------------------------------- | --------------------------------------------------------------------- |
| [`ci.yml`](.github/workflows/ci.yml)             | push & PR to `main`              | lint / typecheck / build / test, plus Docker build for all three apps |
| [`deploy.yml`](.github/workflows/deploy.yml)     | manual (`workflow_dispatch`)     | bump root version, tag, push images to GHCR, cut a GitHub release     |
| [`security.yml`](.github/workflows/security.yml) | weekly cron + PR (path-filtered) | `pnpm audit --prod` + CodeQL (security-extended)                      |

## Deploy targets

We split responsibilities so each piece runs where it fits best. None of
this is wired up automatically — the **Deploy** workflow only publishes
images and tags. Pointing platforms at those tags is one-time setup.

| Component | Recommended                                                | Alternative                                |
| --------- | ---------------------------------------------------------- | ------------------------------------------ |
| Web       | **Vercel** (auto-deploys on tag)                           | Self-host via `apps/web/Dockerfile`        |
| API       | **Railway** or **Fly.io**                                  | Any container host                         |
| Worker    | **Railway** or **Fly.io** with autoscaling (≥ 2 instances) | Any container host with Playwright support |
| Database  | **Neon** (point-in-time recovery)                          | **Supabase**, self-hosted Postgres 16      |
| Redis     | **Upstash** (TLS-only, AOF on)                             | Self-hosted Redis 7                        |
| Storage   | **Cloudflare R2** (S3-compatible)                          | Any S3-compatible bucket                   |

### Backups

- **Postgres:** provider snapshots run daily; retention ≥ 7 days. PITR on.
- **R2:** bucket versioning enabled, lifecycle deletes non-current
  versions after 30 days. Cross-region replication is not enabled — the
  artifacts are reproducible by re-running the analyzer.
- **Redis:** AOF persistence is on but BullMQ state is ephemeral by design.
  Treat Redis loss as a queue reset, not data loss.

See [`docs/RUNBOOK.md`](docs/RUNBOOK.md) for the full operational manual,
[`docs/DEPLOYMENT_CHECKLIST.md`](docs/DEPLOYMENT_CHECKLIST.md) for the
pre-flight checklist, and [`SECURITY.md`](SECURITY.md) for the security
posture and how to report a vulnerability.

## Load testing

`tests/load/` ships two k6 scripts:

- `analyze-burst.js` — 50 concurrent VUs on `POST /api/analyze`, measures
  median + p99 latency.
- `queue-throughput.js` — enqueues 200 jobs and polls them, measures
  wall-clock drain time at the default `WORKER_CONCURRENCY=3`.

Run with `API_URL=… k6 run tests/load/analyze-burst.js`. See
`tests/load/README.md` for the SLO targets we hold the system to.
