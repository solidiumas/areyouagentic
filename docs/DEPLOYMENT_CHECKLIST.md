# Deployment checklist

Pre-flight and post-flight checks for the **Azure** deployment of
areyouagentic.com. The beta ran on Railway + Vercel until November 2026;
those are disconnected, and this list starts fresh for Azure. Check items
off (`[x]`) as they are verified against the live environment, not just
merged in code.

Step-by-step first-time setup: [`AZURE_OPPSETT.md`](AZURE_OPPSETT.md).
Day-to-day operations: [`RUNBOOK.md`](RUNBOOK.md).

## Architecture

| Component                          | Azure resource                               | Reachable from           |
| ---------------------------------- | -------------------------------------------- | ------------------------ |
| Web (Next.js)                      | Container App `aya-prod-web`                 | internet (HTTPS)         |
| API (Fastify)                      | Container App `aya-prod-api`                 | internet (HTTPS)         |
| Worker (BullMQ + Playwright + LLM) | Container App `aya-prod-worker`              | no ingress               |
| Migrations                         | Container Apps job `aya-prod-migrate`        | started by Deploy        |
| Retention                          | Container Apps job `aya-prod-retention`      | daily 03:00 UTC          |
| Postgres 16                        | Database for PostgreSQL Flexible Server      | VNet only (delegated)    |
| Redis                              | Azure Managed Redis (TLS :10000, noeviction) | VNet only (private link) |
| Images                             | Azure Container Registry (Basic)             | apps pull via managed id |
| Logs                               | Log Analytics `aya-prod-logs`                | portal                   |
| Artifacts (R2)                     | **not enabled**                              | —                        |

Deploys run only from the manual **Deploy** workflow — merging to `main`
deploys nothing.

> **Lessons baked into the Dockerfiles / config — don't regress these:**
>
> 1. `pnpm deploy --prod` ships an _un-generated_ Prisma client stub. Each
>    backend Dockerfile copies the build-stage's generated client over the
>    stub (the `find … @prisma+client … cp -a` step). Removing it brings back
>    `@prisma/client did not initialize yet` at runtime.
> 2. Monorepo builds use `turbo run build --filter=<app>` (not `pnpm --filter`)
>    so workspace deps build in topological order.
> 3. `@areyouagentic/db` re-exports Prisma via a default-import shim
>    (`import pkg from '@prisma/client'`) because the package is CommonJS and
>    breaks ESM named re-exports.
> 4. API CORS allows exactly `env.APP_URL` in prod. It **must** be a full
>    `https://…` origin and must match the browser origin exactly.
> 5. Workspace libraries (`shared`, `db`, `analyzers`) build to `dist/` and
>    are imported as JS at runtime — they are no longer consumed as `.ts`.
> 6. `NEXT_PUBLIC_*` are web **build args**; the web image is tied to the
>    URLs it was built with.
> 7. BullMQ keys use the `{bull}` hash-tag prefix on both sides (Azure
>    Managed Redis shards keys; multi-key Lua scripts need one slot).
> 8. `.dockerignore` excludes `**/*.tsbuildinfo`: a stale incremental-build
>    file next to an excluded `dist/` makes `tsc` emit nothing.

## 1. Code & tests

- [ ] `main` green on **CI** (lint, typecheck, build, test, migration
      drift, web E2E, Docker builds for web/api/worker/migrate).
- [ ] `pnpm audit --prod --audit-level=high` clean (Security workflow).
- [ ] CodeQL clean on `main`.
- [ ] No leftover `TODO: prod` / `// remove before launch`:

      ```bash
      git grep -nE 'TODO:.*prod|remove before launch'
      ```

## 2. One-time Azure + GitHub setup

See `AZURE_OPPSETT.md` for the how.

- [ ] Resource group created in the chosen region (Norway East).
- [ ] Resource providers registered: `Microsoft.App`,
      `Microsoft.ContainerRegistry`, `Microsoft.DBforPostgreSQL`,
      `Microsoft.Cache`, `Microsoft.Network`, `Microsoft.OperationalInsights`,
      `Microsoft.ManagedIdentity`.
- [ ] Entra app registration for GitHub Actions with a federated
      credential for `repo:solidiumas/areyouagentic:environment:production`.
- [ ] That app has **Contributor** and **Role Based Access Control
      Administrator** on the resource group (the latter so `main.bicep` can
      grant the apps `AcrPull`).
- [ ] GitHub environment `production` exists, with the variables and
      secrets listed in `.github/workflows/deploy.yml`.

## 3. Secrets

All live on the GitHub `production` environment and are written into
per-app Container Apps secrets on every deploy.

- [ ] `POSTGRES_ADMIN_PASSWORD` — required, ≥16 chars, generated
      (`openssl rand -base64 32`). Used by main.bicep (server) and
      apps.bicep (`DATABASE_URL`).
- [ ] `ANTHROPIC_API_KEY` — **worker only** (optional; LLM step skips if
      absent).
- [ ] `METRICS_PASSWORD` + variable `METRICS_USERNAME` — api.
- [ ] `TURNSTILE_SECRET_KEY` + variable `NEXT_PUBLIC_TURNSTILE_SITE_KEY` —
      set both or neither.
- [ ] `SENTRY_DSN` + variable `NEXT_PUBLIC_SENTRY_DSN` — optional.
- [ ] R2 — **not enabled**; persist skips screenshot upload when unset.
- [ ] No secret values committed in the repo:

      ```bash
      git grep -nE 'sk-[a-zA-Z0-9_-]{20,}|aws_secret|service-role'
      ```

## 4. First deploy

- [ ] **Deploy** workflow run on `main` completes all steps.
- [ ] Migrate job execution _Succeeded_ (`0_init` applied to the empty DB).
- [ ] API: `curl <api-url>/health` →
      `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`.
- [ ] Worker revision _Healthy_ (readiness `/ready` on `:4001`).
- [ ] Retention job present with schedule `0 3 * * *`; one manual run
      (`az containerapp job start … aya-prod-retention`) succeeds.

## 5. Smoke test

- [ ] `POST /api/analyze {"url":"https://example.com"}` → 202 + `jobId`.
- [ ] `GET /api/jobs/<jobId>` → PENDING → … → COMPLETED.
- [ ] `GET /api/reports/<reportId>` → non-zero score, with an LLM verdict
      if `ANTHROPIC_API_KEY` is set.
- [ ] Frontend accepts a URL and renders the report (in a browser).
- [ ] Rate limiting: the 6th `POST /api/analyze` within a minute from one
      IP returns **429** with `RATE_LIMITED`.
- [ ] `TRUST_PROXY` (the apps subnet, set by `infra/apps.bicep`) matches
      the ingress: the API's request logs show the real client IP, not a
      `10.40.x.x` address. If they show an internal IP, the ingress connects
      from outside the subnet and every user shares one rate-limit bucket —
      add the address it uses to `TRUST_PROXY`.
- [ ] Trigger a deliberate error and confirm Sentry capture + PII redaction
      (once Sentry is wired).

## 6. Custom domain

- [ ] `areyouagentic.com` → `aya-prod-web`, `api.areyouagentic.com` →
      `aya-prod-api` (DNS records + managed certificates, see
      `AZURE_OPPSETT.md`).
- [ ] Variables `APP_PUBLIC_URL=https://areyouagentic.com` and
      `API_PUBLIC_URL=https://api.areyouagentic.com` set, then **Deploy**
      re-run (rebuilds web, updates API CORS).
- [ ] Old default hostnames no longer used by the browser (check the CSP
      `connect-src` on the live site).

## 7. Observability

- [ ] `/api/metrics` reachable with basic auth.
- [ ] Logs from all three apps visible in Log Analytics as JSON.
- [ ] Request id propagates web → api → worker (search one id in
      `ContainerAppConsoleLogs_CL`).
- [ ] Budget alert on the resource group (Cost Management).
- [ ] Sentry receiving events from web, api, worker — once wired.

## 8. Abuse & network hardening

- [ ] Re-verify the SSRF guard against the live API:
      `http://169.254.169.254/`, `http://localhost/`, `http://10.40.2.4/`,
      `file:///etc/passwd` are all rejected.
- [ ] Network-layer egress blocking for the worker (SECURITY.md →
      "Deployment hardening"): design an NSG for the `apps` subnet that
      allows the apps subnet, Postgres (`10.40.2.0/24:5432`) and Redis
      (`10.40.3.0/24:10000`) and denies other private ranges; verify it
      against the running environment before enforcing it in `infra/`.
- [ ] Enable Turnstile in production (both keys, then Deploy).

## 9. Backup verification

- [ ] Postgres point-in-time restore rehearsed once (restore to a new
      server, connect, delete it again).
- [ ] (When artifact storage is enabled) verify object versions are
      retrievable.

## 10. On-call & docs

- [ ] At least one more person can run the Deploy workflow and the image
      rollback in `RUNBOOK.md` end-to-end.
- [ ] Sentry alert rules (after Sentry is wired): new prod issue → notify;
      regression → notify; high-volume (>50/h) → page.

## 11. Decommission the old platforms

- [ ] Railway: project deleted (after confirming nothing in it is needed).
- [ ] Vercel: project `nrth-ai-s-projects/areyouagentic` deleted.
- [ ] GitHub: Vercel and Railway apps uninstalled from the repository
      (removes the Vercel PR check and push-triggered builds).

## 12. Day-after

- [ ] First 24h: `/api/metrics` `errorRate` ≤ baseline.
- [ ] First 24h: no unexplained `byStatus.FAILED` spikes.
- [ ] First week: every distinct Sentry issue (once wired) has a fix queued
      or a "won't fix" rationale.
