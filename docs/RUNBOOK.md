# Run-book

Operational reference for the people on call. Every section is meant to be
short enough to act on at 3am.

First-time setup of the Azure environment is in
[`AZURE_OPPSETT.md`](AZURE_OPPSETT.md); this document assumes it exists.

---

## Architecture in one paragraph

Everything runs in one Azure resource group (default prefix `aya-prod`),
defined in [`infra/`](../infra). The user hits **web** (Next.js, Container
App `aya-prod-web`), which calls the **api** (Fastify, `aya-prod-api`). The
API inserts an `AnalysisJob` row in **Postgres** (Azure Database for
PostgreSQL Flexible Server) and enqueues a BullMQ job in **Redis** (Azure
Managed Redis). The **worker** (`aya-prod-worker`, Playwright base image,
no ingress) picks it up, scrapes the URL, runs analyzers, and writes a
`Report` row. Postgres and Redis have no public endpoint: they are reachable
only from the Container Apps environment's VNet. Screenshot upload to **R2**
is still off — persist skips the upload when the R2 env vars are unset. The
frontend polls `/api/jobs/:id` until COMPLETED, then fetches the report.

Two Container Apps jobs run next to the apps: `aya-prod-migrate` (manual,
started by every deploy) and `aya-prod-retention` (daily 03:00 UTC, deletes
analyses older than `RETENTION_DAYS`).

Logs ship as JSON (pino) to the environment's **Log Analytics** workspace
(`aya-prod-logs`). Errors fan out to **Sentry** when `SENTRY_DSN` is set.
The `/api/metrics` JSON endpoint (basic-auth) exposes job counts, duration
percentiles, error rate, and (eventually) LLM token usage.

---

## How to deploy

### Production deploy

Run the **Deploy** workflow (`.github/workflows/deploy.yml`) from the Actions
tab on `main`. It is manual on purpose: merging to `main` deploys nothing.

1. Verify `main` is green on the [CI workflow](../.github/workflows/ci.yml)
   (lint, typecheck, build, test, migration drift, E2E, Docker builds).
2. Actions → **Deploy** → Run workflow (branch `main`). The job:
   1. applies `infra/main.bicep` (core infra; normally a no-op),
   2. builds and pushes `web`, `api`, `worker` and `migrate` images to ACR,
      tagged with the commit SHA,
   3. points `aya-prod-migrate` at the new image, runs it and waits —
      a failed migration stops the deploy before any new code starts,
   4. applies `infra/apps.bicep`, which rolls the three apps and the
      retention job to the new images,
   5. smoke-checks `GET /health` on the API and `GET /` on web.
3. Watch:
   - The workflow's smoke-check step (`{"status":"ok","checks":{"database":"ok","redis":"ok"}}`).
   - Portal → each Container App → **Revisions and replicas**: the new
     revision should be _Running_ and _Healthy_. The worker has no ingress;
     its readiness probe (`/ready` on `:4001`) is what turns it healthy.
   - Sentry "Last hour" view for new issues (once Sentry is wired).
   - `/api/metrics` for `errorRate` and `p99` regressions.

**Deploy-time gotchas (don't regress these):**

- **Prisma client copy:** `pnpm deploy --prod` ships an _un-generated_
  Prisma client stub. Each backend Dockerfile copies the build-stage's
  generated client over the stub (the `find … @prisma+client … cp -a`
  step). Removing it brings back `@prisma/client did not initialize yet`
  at runtime.
- **`APP_URL` (api, CORS):** must be a full `https://…` origin and match
  the browser origin exactly. `infra/apps.bicep` derives it from the web
  app's hostname, or from the `APP_PUBLIC_URL` variable once a custom
  domain is attached.
- **`NEXT_PUBLIC_*` (web):** inlined into the bundle _and_ the CSP at
  build time (Docker build args). Changing `API_PUBLIC_URL`,
  `APP_PUBLIC_URL` or the Turnstile/Sentry public keys does nothing until
  the next Deploy run rebuilds the web image.
- **BullMQ key prefix:** producer and consumer both use
  `QUEUE_PREFIX = '{bull}'` (hash tag) because Azure Managed Redis shards
  keys and BullMQ's Lua scripts need all of a queue's keys in one slot.
  Changing it on one side only splits the queue.
- Monorepo builds use `turbo run build --filter=<app>` (not
  `pnpm --filter`) so workspace deps build in topological order.

### Staging deploy

There is no staging environment yet. Pre-merge verification is CI
(including the Docker image builds) plus running the stack locally with
`docker compose`. A staging copy is a second resource group deployed with a
different `AZURE_PREFIX` on a second GitHub environment.

### Database migrations

Migrations live in `packages/db/prisma/migrations/` and are applied by the
`aya-prod-migrate` job (image: `packages/db/Dockerfile`, which runs
`prisma migrate deploy`) as step 3 of every deploy. Postgres has no public
endpoint, so migrations cannot run from a laptop or a GitHub runner.

The runtime images do **not** contain the Prisma CLI — don't try to run
migrations from inside a deployed app container.

Migrations run while the previous revision is still serving, so they must
be backward compatible with the currently deployed code (expand/contract:
add columns/tables first, ship code that uses them, drop old columns in a
later migration).

Re-run the latest migration image by hand:

```bash
az containerapp job start -g <rg> -n aya-prod-migrate
az containerapp job execution list -g <rg> -n aya-prod-migrate -o table
```

---

## How to roll back

**Fastest path** (no rebuild): every deploy pushes images tagged with the
commit SHA, so point the apps back at the previous good SHA.

```bash
PREV=<previous good commit sha>
REG=$(az acr list -g <rg> --query '[0].loginServer' -o tsv)
for app in api worker web; do
  az containerapp update -g <rg> -n aya-prod-$app --image "$REG/$app:$PREV"
done
```

Then confirm API `/health` is green, the new revisions are healthy, and
`/api/metrics` `errorRate` and `p99` are back to baseline.

**Durable path:** `git revert` the bad commit on `main` and run **Deploy**
again. Do this after (or instead of) the image rollback, otherwise the
next deploy ships the bad code again.

**If a migration is in the bad release**, the rollback gets harder:

- Prisma migrations are forward-only by default. If the bad migration was
  destructive (dropped a column, narrowed a type), the previous app
  version won't be able to read the new schema.
- Mitigation: deploy migrations in two phases (additive first, removal
  later). The release that "removes" a column should be N+1 after the
  release that stopped writing to it.
- If you're stuck: restore Postgres to a point in time before the
  migration (Portal → the Flexible Server → **Overview → Restore**; this
  creates a _new_ server, so point `DATABASE_URL` at it by redeploying with
  the new server name) and roll the apps back to the previous image.

---

## How to handle queue backlog

Symptoms:

- `GET /api/metrics` `byStatus.PENDING` climbing.
- Job duration p99 ballooning (jobs waiting in queue).
- User-visible "still analyzing…" beyond 60s.

Triage:

1. Worker health: Portal → `aya-prod-worker` → **Revisions and replicas**.
   Is the replica running and healthy? A worker that can't reach Postgres
   or Redis fails its readiness probe and logs it loudly — fix that first.

2. Worker logs:

   ```bash
   az containerapp logs show -g <rg> -n aya-prod-worker --follow
   ```

   Crash-looping? Restart the revision:
   `az containerapp revision restart -g <rg> -n aya-prod-worker --revision <name>`.

3. Concurrency:
   - Default `WORKER_CONCURRENCY=3` per replica (`workerConcurrency` in
     `infra/apps.bicep`).
   - Bump to 4–5 if CPU and memory stay under 70% (Portal → Metrics).
   - **Do not** raise above 8 — Playwright/Chromium memory grows linearly
     and a 4 GiB replica will OOM.

4. Scale out: raise `maxReplicas`/`minReplicas` on the worker in
   `infra/apps.bicep` and deploy. BullMQ distributes jobs across replicas
   automatically.

5. Inspect by hand (last resort). Redis is private, so go through a
   running container that has `ioredis`:

   ```bash
   az containerapp exec -g <rg> -n aya-prod-api --command sh
   # inside the container:
   node -e '
     const { Redis } = require("ioredis");
     const r = new Redis(process.env.REDIS_URL);
     Promise.all([r.llen("{bull}:analysis:wait"), r.llen("{bull}:analysis:active")])
       .then(([wait, active]) => { console.log({ wait, active }); r.quit(); });
   '
   ```

Recovery time: BullMQ pulls jobs FIFO. Plan capacity against the latest
`queue-throughput.js` k6 run.

---

## How to handle LLM-quota errors

Symptoms:

- `byStatus.FAILED` jumps.
- Sentry issues tagged `app:worker` with `429`, `rate_limit`,
  `insufficient_quota`, or `overloaded_error` from Anthropic.
- `errorMessage` on `AnalysisJob` rows mentions Anthropic.

Actions:

1. **Confirm it's quota, not a bug.** Check `https://status.anthropic.com`
   and the Anthropic console.
2. **Slow the queue.** Set `workerConcurrency` to 1 and deploy, or
   immediately:
   `az containerapp update -g <rg> -n aya-prod-worker --set-env-vars WORKER_CONCURRENCY=1`
   (the next Deploy run resets it to the Bicep value).
3. **Disable enqueue if it's worse.** Set `ANALYZE_PER_MINUTE.max = 0` in
   `apps/api/src/lib/rateLimiter.ts` and deploy — users see a 429 instead
   of jobs piling up to fail.
4. **Run without the LLM.** Removing the `ANTHROPIC_API_KEY` secret from the
   GitHub environment and redeploying makes the worker skip the LLM step;
   reports still get their deterministic score.
5. **Catch up.** Once quota returns, restore concurrency and let the queue
   drain. Failed jobs aren't auto-retried at the user level — users re-submit.

---

## Common failure modes

### `503 QUEUE_UNAVAILABLE` from POST /api/analyze

Redis is unreachable from the API.

- Portal → the Redis resource (`aya-prod-redis-*`): is it running?
- The private endpoint `aya-prod-redis-*-pe` must be _Approved_ and the
  `privatelink.redis.azure.net` DNS zone linked to `aya-prod-vnet`.
- The API marks the AnalysisJob row FAILED and tells the user to retry.

### `GET /health` returns 503

Look at the `checks` object in the response:

- `database: fail` → Postgres unreachable or rejecting the login. Check the
  Flexible Server is running, and that `POSTGRES_ADMIN_PASSWORD` in the
  GitHub environment matches the server (both Bicep files use it).
- `redis: fail` → see the Redis checks above.

### API won't start after a config change

`APP_URL` (the CORS origin) is validated as a URL at boot: a bare host
crashes the API. Set `APP_PUBLIC_URL` to a full origin
(`https://areyouagentic.com`) or leave it empty to use the default
hostname, then deploy. It must match the browser origin exactly, or every
browser request fails CORS.

### Worker stuck on a job (lock keeps expiring)

A single job is exceeding `JOB_TIMEOUT_MS` (90s). BullMQ reaps it as
stalled and re-picks it up.

- Mark it failed in the DB so the next pickup is a no-op (via
  `az containerapp exec` into the api container, with Prisma):

  ```bash
  node -e '
    const { PrismaClient } = require("@prisma/client");
    const p = new PrismaClient();
    p.analysisJob.update({ where: { id: "<jobId>" },
      data: { status: "FAILED", errorMessage: "manually failed: stalled", completedAt: new Date() } })
      .then(() => p.$disconnect());
  '
  ```

- Then remove it from BullMQ (same container, ioredis):
  `r.del("{bull}:analysis:<jobId>")`.

### Memory growth on the worker

Playwright leaks small amounts of native memory per browser context. We
close contexts after each job; if a replica still grows past its 4 GiB
limit, Container Apps restarts it. Frequent restarts → lower
`WORKER_CONCURRENCY` before raising memory.

### Web app blank page / Next.js crash

- Portal → `aya-prod-web` → revision health and logs.
- If API calls fail from the browser, remember `NEXT_PUBLIC_API_URL` is
  baked into the bundle at build time — check it matches the live API URL
  (`API_PUBLIC_URL`, or the API's default hostname) and redeploy.
- Look at the latest Sentry browser-side issues (once Sentry is wired).
- Roll back with the image rollback above.

---

## Backups

- **Postgres:** automatic backups with point-in-time restore, retention
  `postgresBackupRetentionDays` (default 7) in `infra/main.bicep`. A
  restore creates a new server. Rehearse one before relying on it.
- **R2 artifacts:** not enabled — no screenshots are uploaded yet. When
  storage is enabled (likely Azure Blob Storage instead of R2): versioning
  plus a 30-day lifecycle rule; the data is reproducible (re-run the
  analyzer) so no cross-region replica.
- **Redis:** BullMQ state is ephemeral by design. Treat Redis loss as a
  queue reset, not a data-loss event.
- **Secrets:** the source of truth is the `production` environment in
  GitHub (Settings → Environments). The deploy writes them into per-app
  Container Apps secrets. If a credential leaks: rotate it at the source
  (e.g. a new Postgres password in `POSTGRES_ADMIN_PASSWORD`), then run
  **Deploy** — main.bicep sets the new Postgres password and apps.bicep
  rolls every app onto it.

---

## Useful commands

```bash
# Read the API metrics (basic-auth — METRICS_USERNAME / METRICS_PASSWORD)
curl -u "$METRICS_USERNAME:$METRICS_PASSWORD" "$API_URL/api/metrics" | jq

# Tail logs
az containerapp logs show -g <rg> -n aya-prod-api --follow
az containerapp logs show -g <rg> -n aya-prod-worker --follow

# Query Log Analytics (Portal → aya-prod-logs → Logs), e.g. one request id
#   ContainerAppConsoleLogs_CL | where Log_s has "<request-id>"

# Shell into a running container (Postgres/Redis are only reachable from here)
az containerapp exec -g <rg> -n aya-prod-api --command sh

# Retention job: run now / see past runs
az containerapp job start -g <rg> -n aya-prod-retention
az containerapp job execution list -g <rg> -n aya-prod-retention -o table

# Manual smoke test against production
curl -X POST "$API_URL/api/analyze" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://example.com"}'
# → 202 + jobId; then poll GET /api/jobs/<jobId> until COMPLETED
```

---

## Escalation

- Anthropic quota or model issues → Anthropic support
  (`support@anthropic.com`).
- Azure → [status.azure.com](https://status.azure.com), then a support
  request from the portal.
- Internal: on-call rotation in PagerDuty (or Slack `#oncall` if you
  haven't set up paging yet).
