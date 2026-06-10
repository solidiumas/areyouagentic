# Run-book

Operational reference for the people on call. Every section is meant to be
short enough to act on at 3am.

---

## Architecture in one paragraph

The user hits **web** (Next.js on Vercel) which calls the **api**
(Fastify on Railway/Fly.io). The API inserts an `AnalysisJob` row in
**Postgres** (Neon) and enqueues a BullMQ job in **Redis** (Upstash). One
of the **worker** instances (Railway/Fly.io, Playwright base image) picks
it up, scrapes the URL, runs analyzers, writes a `Report` row, and uploads
screenshots/artifacts to **R2** (Cloudflare). The frontend polls
`/api/jobs/:id` until COMPLETED, then fetches the report.

Logs ship as JSON to whatever pipeline the platform provides (Vercel logs,
Railway logs, Datadog/Loki for self-host). Errors fan out to **Sentry**.
The `/api/metrics` JSON endpoint (basic-auth) exposes job counts, duration
percentiles, error rate, and (eventually) LLM token usage.

---

## How to deploy

### Production deploy (manual, from main)

1. Verify `main` is green on the [CI workflow](../.github/workflows/ci.yml).
2. GitHub → **Actions** → **Deploy** → **Run workflow**.
3. Choose `bump = patch | minor | major` and `environment = production`.
4. The workflow:
   - bumps `package.json`, tags `vX.Y.Z`, pushes both;
   - builds and pushes three images to `ghcr.io/<repo>/{api,worker,web}` tagged
     with `vX.Y.Z`, `production-latest`, and the commit SHA;
   - creates a GitHub release with auto-generated notes.
5. Platform-side rollout:
   - **Vercel (web):** auto-deploys on tag push (configure the project to
     watch `v*` tags).
   - **Railway / Fly.io (api + worker):** point each service at
     `ghcr.io/<repo>/<app>:production-latest` and trigger a redeploy. Both
     respect `SIGTERM`; their graceful-shutdown logic drains in-flight
     work (90s + 5s buffer for the worker).
6. Watch:
   - `/health` on the API (200 = ready).
   - Worker `:4001/health` (200 = DB + Redis reachable).
   - Sentry "Last hour" view for new issues.
   - `/api/metrics` for `errorRate` and `p99` regressions.

### Staging deploy

Same workflow, `environment = staging`. Pushes the same tags plus
`staging-latest`. Point a separate Railway/Vercel project at the staging
tag.

### First-time database migration on a new environment

```bash
# Connect to the deployed API container and run the migrations once.
railway run --service api  pnpm --filter @areyouagentic/db prisma migrate deploy
# Or on Fly.io:
fly ssh console -a areyouagentic-api -C "pnpm --filter @areyouagentic/db prisma migrate deploy"
```

Migrations are idempotent. Run again after every deploy that includes a
`packages/db/prisma/migrations/*` change.

---

## How to roll back

**Fastest path** (no rebuild):

1. In Railway/Fly.io, change the image tag of each service from
   `production-latest` (or `vX.Y.Z`) back to `vX.Y.(Z-1)` and redeploy.
2. In Vercel, promote the previous deployment from the **Deployments**
   tab.
3. Confirm `/health` is green on the API and worker.
4. Check `/api/metrics` `errorRate` and `p99` are back to baseline.

**If a migration is in the bad release**, the rollback gets harder:

- Prisma migrations are forward-only by default. If the bad migration was
  destructive (dropped a column, narrowed a type), the previous app
  version won't be able to read the new schema.
- Mitigation: deploy migrations in two phases (additive first, removal
  later). The release that "removes" a column should be N+1 after the
  release that stopped writing to it.
- If you're stuck: restore the most recent Neon point-in-time snapshot to
  a new branch, swap `DATABASE_URL`, and re-run the previous app version.

---

## How to handle queue backlog

Symptoms:

- `GET /api/metrics` `byStatus.PENDING` climbing.
- Job duration p99 ballooning (jobs waiting in queue).
- User-visible "still analyzing…" beyond 60s.

Triage:

1. Worker health:

   ```bash
   curl -fsS https://worker.areyouagentic.com:4001/health
   ```

   If 503, the worker can't reach DB or Redis — fix that first.

2. Worker count:

   ```bash
   railway status --service worker
   # or:  fly status -a areyouagentic-worker
   ```

   Are all instances healthy? Restart any that are crash-looping.

3. Concurrency:
   - Default `WORKER_CONCURRENCY=3` per instance.
   - Bump to 4–5 if CPU is under 70% and memory is under 70%.
   - **Do not** raise above 8 — Playwright/Chromium memory grows linearly
     and you'll OOM the box.

4. Scale out:
   - Add a worker instance via the platform's "duplicate service" or
     `fly scale count N`.
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
2. **Slow the queue.** Reduce `WORKER_CONCURRENCY` to 1 on every instance
   and redeploy. Jobs will keep flowing but stop competing for the
   per-minute Anthropic budget.
3. **Disable enqueue if it's worse.** Toggle the API into read-only mode
   by setting `ANALYZE_PER_MINUTE.max=0` and redeploying — users see a
   429 instead of jobs piling up to fail.
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

- Check Upstash status.
- Check `REDIS_URL` and that the API container has egress to it.
- The API marks the AnalysisJob row FAILED and tells the user to retry.

### `GET /health` returns 503

Look at the `checks` object in the response:

- `database: fail` → Postgres unreachable. Check Neon status, connection
  string, IP allowlist if you have one.
- `redis: fail` → Upstash unreachable. Same drill.

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
Set the limit to ~1.5 GiB on Fly.io / Railway and let it cycle.

### Web app blank page / Next.js crash

- Check the Vercel deployment status.
- Look at the latest Sentry browser-side issues — `@sentry/nextjs` captures
  client errors with full source maps when `SENTRY_AUTH_TOKEN` is set in
  CI.
- Roll back via Vercel's promote-previous-deployment.

---

## Backups

- **Postgres (Neon):** daily snapshots are provider-managed; Neon retains
  7 days on the free tier, 30 on paid. Point-in-time recovery enabled.
  Verify monthly by restoring the latest snapshot to a throwaway branch.
- **R2 artifacts:** bucket versioning is enabled. Lifecycle rule deletes
  non-current versions after 30 days. There's no cross-region replication
  — the data is reproducible (re-run the analyzer) so the recovery time
  vs. cost trade-off favors no replica.
- **Redis (Upstash):** AOF persistence is enabled but BullMQ state is
  ephemeral by design. We treat Redis loss as a queue reset, not a data
  loss event.
- **Secrets:** stored in the platform's secret manager. The team's
  password manager has a "break glass" export for disaster recovery.

---

## Useful commands

```bash
# Read the API metrics (basic-auth — set in METRICS_USERNAME/PASSWORD)
curl -u "$METRICS_USERNAME:$METRICS_PASSWORD" \
     https://api.areyouagentic.com/api/metrics | jq

# Tail API logs (Railway)
railway logs --service api --tail

# Tail worker logs (Fly.io)
fly logs -a areyouagentic-worker

# Connect to Neon
psql "$DATABASE_URL"

# Connect to Upstash
redis-cli -u "$REDIS_URL"

# Re-run migrations
pnpm --filter @areyouagentic/db prisma migrate deploy

# Manual smoke test against staging
curl -X POST https://staging-api.areyouagentic.com/api/analyze \
     -H "Content-Type: application/json" \
     -d '{"url":"https://example.com"}'
```

---

## Escalation

- Anthropic quota or model issues → Anthropic support
  (`support@anthropic.com`).
- Vercel / Neon / Upstash / Cloudflare / Railway / Fly.io →
  the provider's status page first, then a support ticket.
- Internal: on-call rotation in PagerDuty (or Slack `#oncall` if you
  haven't set up paging yet).
