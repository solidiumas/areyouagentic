# Run-book

Operational reference for the people on call. Every section is meant to be
short enough to act on at 3am.

---

## Architecture in one paragraph

The user hits **web** (Next.js on Vercel) which calls the **api**
(Fastify on Railway, Docker). The API inserts an `AnalysisJob` row in
**Postgres** (Railway managed) and enqueues a BullMQ job in **Redis**
(Railway managed). The **worker** (Railway, Docker, Playwright base image)
picks it up, scrapes the URL, runs analyzers, and writes a `Report` row.
Screenshot/artifact upload to **R2** (Cloudflare) is deferred for the beta
— persist skips the upload when R2 env vars are unset. The frontend polls
`/api/jobs/:id` until COMPLETED, then fetches the report.

Logs ship as JSON (pino) to the platform's pipeline (Vercel logs, Railway
logs). Errors fan out to **Sentry** once the DSNs are wired — that's still
pending for the beta, so until then the logs are the only error trail.
The `/api/metrics` JSON endpoint (basic-auth) exposes job counts, duration
percentiles, error rate, and (eventually) LLM token usage.

---

## How to deploy

### Production deploy (push to main)

Deploys are GitHub-driven — there is no tag-based or GHCR-image deploy in
the beta. Merging/pushing to `main` **is** the deploy.

1. Verify `main` is green on the [CI workflow](../.github/workflows/ci.yml)
   (lint, typecheck, build, test, Docker image builds for all three apps).
2. Push to `main`:
   - **Railway (api + worker):** rebuilds each service from its own
     Dockerfile (`apps/api/Dockerfile`, `apps/worker/Dockerfile`). Both
     respect `SIGTERM`; their graceful-shutdown logic drains in-flight
     work (90s + 5s buffer for the worker).
   - **Vercel (web):** rebuilds the project with root directory `apps/web`
     (`vercel.json` drives install + `turbo` build).
   - **Migrations:** the Migrate workflow runs `prisma migrate deploy` in
     parallel with the rebuilds — see "Database migrations" below.
3. Watch:
   - `/health` on the API
     (`curl https://api-production-6eca.up.railway.app/health` →
     `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`).
   - Worker: the health server on `:4001` is Railway-internal — check the
     service status and logs in the Railway dashboard instead, then confirm
     it drains the queue with the smoke test in "Useful commands".
   - Sentry "Last hour" view for new issues (once Sentry is wired).
   - `/api/metrics` for `errorRate` and `p99` regressions.

**Deploy-time gotchas (don't regress these):**

- **Prisma client copy:** `pnpm deploy --prod` ships an _un-generated_
  Prisma client stub. Each backend Dockerfile copies the build-stage's
  generated client over the stub (the `find … @prisma+client … cp -a`
  step). Removing it brings back `@prisma/client did not initialize yet`
  at runtime.
- **`APP_URL` (api, CORS):** must be a full `https://…` origin (Zod
  validates it as a URL; a bare host crashes the API on boot) and must
  match the browser origin exactly — currently
  `https://areyouagentic.vercel.app`.
- **`NEXT_PUBLIC_API_URL` (Vercel):** baked into the web bundle at build
  time. Changing it does nothing until you redeploy web.
- Monorepo builds use `turbo run build --filter=<app>` (not
  `pnpm --filter`) so workspace deps build in topological order.

### Staging deploy

There is no staging environment in the beta. Pre-merge verification is CI
(including the Docker image builds) plus running the stack locally with
`docker compose`. If you need a shared preview of a web change, use the
Vercel preview deployment for the PR branch.

### Database migrations

Migrations live in `packages/db/prisma/migrations/` and are applied by the
**Migrate** GitHub workflow (`.github/workflows/migrate.yml`), which runs
`prisma migrate deploy` against the production database whenever a new
migration lands on `main` (and on manual dispatch). It authenticates via the
repo secret `PROD_DATABASE_URL` (Railway → Postgres → `DATABASE_PUBLIC_URL`).

The runtime images do **not** contain the Prisma CLI — don't try to run
migrations from inside a deployed container.

Because the Migrate workflow and the Railway image rebuild run in parallel,
migrations must be backward compatible with the currently deployed code
(expand/contract: add columns/tables first, ship code that uses them, drop
old columns in a later migration).

**One-time baseline (beta):** the beta database was originally provisioned
with `prisma db push`, so before the first `migrate deploy` the init
migration must be marked as already applied:

```bash
DATABASE_URL=<DATABASE_PUBLIC_URL> \
  pnpm --filter @areyouagentic/db exec prisma migrate resolve --applied 0_init
```

Manual fallback if the workflow is unavailable:

```bash
DATABASE_URL=<DATABASE_PUBLIC_URL> \
  pnpm --filter @areyouagentic/db exec prisma migrate deploy
```

---

## How to roll back

**Fastest path** (no rebuild):

1. In Railway, open each affected service (api, worker) → **Deployments**
   → pick the previous good deployment → **Redeploy**.
2. In Vercel, promote the previous deployment from the **Deployments**
   tab.
3. Confirm the API `/health` is green and the worker is online in the
   Railway dashboard.
4. Check `/api/metrics` `errorRate` and `p99` are back to baseline.

**Durable path:** `git revert` the bad commit and push to `main` — that
triggers fresh Railway + Vercel builds of the reverted code. Do this after
(or instead of) the dashboard rollback, otherwise the next unrelated push
to `main` redeploys the bad code.

**If a migration is in the bad release**, the rollback gets harder:

- Prisma migrations are forward-only by default. If the bad migration was
  destructive (dropped a column, narrowed a type), the previous app
  version won't be able to read the new schema.
- Mitigation: deploy migrations in two phases (additive first, removal
  later). The release that "removes" a column should be N+1 after the
  release that stopped writing to it.
- If you're stuck: restore the most recent Railway Postgres backup (take a
  manual snapshot before any risky migration — the plan's automatic backup
  cadence hasn't been confirmed) and re-run the previous app version
  against it.

---

## How to handle queue backlog

Symptoms:

- `GET /api/metrics` `byStatus.PENDING` climbing.
- Job duration p99 ballooning (jobs waiting in queue).
- User-visible "still analyzing…" beyond 60s.

Triage:

1. Worker health:

   The worker's health server on `:4001` is Railway-internal (no public
   URL). Check the worker service in the Railway dashboard: is the latest
   deployment online, and do the logs show it processing jobs? A worker
   that can't reach DB or Redis logs it loudly — fix that first.

2. Worker status:

   ```bash
   railway logs --service worker
   ```

   Is the instance healthy? Restart it from the Railway dashboard if it's
   crash-looping.

3. Concurrency:
   - Default `WORKER_CONCURRENCY=3` per instance.
   - Bump to 4–5 if CPU is under 70% and memory is under 70%.
   - **Do not** raise above 8 — Playwright/Chromium memory grows linearly
     and you'll OOM the box.

4. Scale out:
   - Add a worker instance via Railway's replicas / duplicate-service
     option.
   - BullMQ distributes jobs across all instances automatically — no
     config change needed.

5. Drain by hand (last resort):

   ```bash
   # Connect a redis-cli to the BullMQ instance and inspect:
   redis-cli -u "$REDIS_URL"
     > LRANGE bull:analysis:wait 0 -1   # waiting jobs
     > LLEN  bull:analysis:active        # in-flight
   # To purge a stuck job (rare — only if you know it's not retryable):
   #   DEL bull:analysis:<jobId>
   ```

Recovery time: BullMQ pulls jobs FIFO. With three workers at default
concurrency, throughput is ~50 jobs/min for stubbed stages, materially
slower once real Playwright + Anthropic calls are wired in. Plan capacity
against the latest `queue-throughput.js` k6 run.

---

## How to handle LLM-quota errors

Symptoms:

- `byStatus.FAILED` jumps.
- Sentry issues tagged `app:worker` with `429`, `rate_limit`,
  `insufficient_quota`, or `overloaded_error` from Anthropic.
- `errorMessage` on `AnalysisJob` rows mentions Anthropic.

Actions:

1. **Confirm it's quota, not a bug.** Hit
   `https://status.anthropic.com` and the Anthropic console.
2. **Slow the queue.** Set `WORKER_CONCURRENCY=1` on the worker service
   in Railway and redeploy it. Jobs will keep flowing but stop competing
   for the per-minute Anthropic budget.
3. **Disable enqueue if it's worse.** Set `ANALYZE_PER_MINUTE.max = 0` in
   `apps/api/src/lib/rateLimiter.ts` and push to `main` (it's a code
   constant, so this ships via a normal deploy) — users see a 429 instead
   of jobs piling up to fail.
4. **Failover.** If quota is provider-side and won't recover in <30 min,
   page the on-call engineer to coordinate with Anthropic support; the
   Anthropic API key in `ANTHROPIC_API_KEY` is per-org.
5. **Catch up.** Once quota returns, set concurrency back to 3 and let
   the queue drain. Failed jobs aren't auto-retried at the user level —
   they'd need to re-submit. If you want to retry the batch, you can
   enqueue them by `jobId` directly (see the BullMQ docs).

---

## Common failure modes

### `503 QUEUE_UNAVAILABLE` from POST /api/analyze

Redis is unreachable from the API.

- Check the Railway Redis service in the dashboard.
- Check `REDIS_URL` — it should reference the Railway-managed instance
  (`${{Redis.REDIS_URL}}`).
- The API marks the AnalysisJob row FAILED and tells the user to retry.

### `GET /health` returns 503

Look at the `checks` object in the response:

- `database: fail` → Postgres unreachable. Check the Railway Postgres
  service and that `DATABASE_URL` is `${{Postgres.DATABASE_URL}}`.
- `redis: fail` → Railway Redis unreachable. Same drill.

### API crash-loops right after an env-var change

`APP_URL` (the CORS origin) is validated as a URL at boot. A bare host
like `areyouagentic.vercel.app` (no `https://`) crashes the API on
startup. Set the full origin — `https://areyouagentic.vercel.app` — and
redeploy. It must also match the browser origin exactly, or every browser
request fails CORS.

### Worker stuck on a job (lock keeps expiring)

A single job is exceeding `JOB_TIMEOUT_MS` (90s). BullMQ reaps it as
stalled and re-picks it up, looping forever.

- Find the job: `redis-cli LRANGE bull:analysis:stalled 0 -1`.
- Mark it failed in the DB and let `UnrecoverableError` keep BullMQ off
  it:

  ```sql
  UPDATE "AnalysisJob"
  SET status = 'FAILED', "errorMessage" = 'manually failed: stalled',
      "completedAt" = now()
  WHERE id = '<jobId>';
  ```

- Remove it from BullMQ:

  ```bash
  redis-cli -u "$REDIS_URL" DEL "bull:analysis:<jobId>"
  ```

### Memory growth on the worker

Playwright leaks small amounts of native memory per browser context.
We mitigate by closing contexts after each job; if the process still
grows over a day, the platform's auto-restart-on-memory-limit catches it.
Set the limit to ~1.5 GiB on Railway and let it cycle.

### Web app blank page / Next.js crash

- Check the Vercel deployment status.
- If API calls fail from the browser, remember `NEXT_PUBLIC_API_URL` is
  baked into the bundle at build time — a changed value only takes effect
  after a web redeploy. Check it matches the live API URL.
- Look at the latest Sentry browser-side issues (once Sentry is wired) —
  `@sentry/nextjs` captures client errors with full source maps when
  `SENTRY_AUTH_TOKEN` is set in CI. Until then, use Vercel logs.
- Roll back via Vercel's promote-previous-deployment.

---

## Backups

- **Postgres (Railway managed):** the automatic backup cadence for the
  current plan hasn't been confirmed yet — check it in the Railway
  dashboard, and take a manual snapshot before any risky migration.
  Rehearse a restore before relying on it.
- **R2 artifacts:** deferred for the beta — no screenshots are uploaded,
  so there is nothing to back up yet. When R2 is enabled: bucket
  versioning + a 30-day lifecycle rule; the data is reproducible (re-run
  the analyzer) so no cross-region replica.
- **Redis (Railway managed):** BullMQ state is ephemeral by design. We
  treat Redis loss as a queue reset, not a data loss event.
- **Secrets:** stored in the platform's variable manager (Railway
  per-service, Vercel project). The team's password manager has a "break
  glass" export for disaster recovery. If a credential leaks (it happened
  once with the Postgres password during setup): Railway Postgres →
  Config → Regenerate password, then redeploy api + worker so they pick
  up the new `${{Postgres.DATABASE_URL}}`.

---

## Useful commands

```bash
# Read the API metrics (basic-auth — set in METRICS_USERNAME/PASSWORD)
curl -u "$METRICS_USERNAME:$METRICS_PASSWORD" \
     https://api-production-6eca.up.railway.app/api/metrics | jq

# Tail API logs (Railway)
railway logs --service api --tail

# Tail worker logs (Railway)
railway logs --service worker --tail

# Connect to Railway Postgres (from outside Railway, use the public URL:
# Railway → Postgres → DATABASE_PUBLIC_URL)
psql "$DATABASE_PUBLIC_URL"

# Connect to Railway Redis (public URL from the Redis service's variables)
redis-cli -u "$REDIS_URL"

# Re-run migrations (see "Database migrations" for the full drill)
DATABASE_URL=<DATABASE_PUBLIC_URL> \
  pnpm --filter @areyouagentic/db exec prisma migrate deploy

# Manual smoke test against production
curl -X POST https://api-production-6eca.up.railway.app/api/analyze \
     -H "Content-Type: application/json" \
     -d '{"url":"https://example.com"}'
# → 202 + jobId; then poll GET /api/jobs/<jobId> until COMPLETED
```

---

## Escalation

- Anthropic quota or model issues → Anthropic support
  (`support@anthropic.com`).
- Vercel / Railway (and Cloudflare once R2 is enabled) →
  the provider's status page first, then a support ticket.
- Internal: on-call rotation in PagerDuty (or Slack `#oncall` if you
  haven't set up paging yet).
