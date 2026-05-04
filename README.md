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

| Command            | What it does                                    |
| ------------------ | ----------------------------------------------- |
| `pnpm dev`         | Run all apps in dev mode                        |
| `pnpm build`       | Build everything (Turbo handles dep order)      |
| `pnpm lint`        | ESLint across the monorepo                      |
| `pnpm typecheck`   | `tsc --noEmit` in every workspace               |
| `pnpm test`        | Run all test suites                             |
| `pnpm format`      | Prettier write                                  |
| `pnpm format:check`| Prettier check (used in CI)                     |
| `pnpm clean`       | Remove build artifacts and `node_modules`       |

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

## Next steps

The app skeletons are intentionally empty. Each app gets its own
dependencies in follow-up steps:

- Wire up Next.js in `apps/web`
- Wire up Fastify + Zod + Prisma in `apps/api`
- Wire up BullMQ + analyzers in `apps/worker`
- Add the Prisma schema in `packages/db/prisma`
