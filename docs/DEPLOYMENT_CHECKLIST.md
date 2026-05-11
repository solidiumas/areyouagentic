# Deployment checklist

Tick every box before pointing `areyouagentic.com` at production. Each item
is something we've been bitten by at least once in someone's career.

## 1. Code & tests

- [ ] `main` is green on the **CI** workflow (lint, typecheck, build, test,
      and Docker builds for all three apps).
- [ ] `pnpm audit --prod --audit-level=high` clean (or known advisories
      tracked in an issue).
- [ ] CodeQL run on `main` clean — see the **Security** workflow.
- [ ] No `TODO: prod` or `// remove before launch` strings:

      ```bash
      git grep -nE 'TODO:.*prod|remove before launch'
      ```

- [ ] `.env.example` lists every variable that production reads.

## 2. Secrets

Every variable from `.env.example` has a value in the platform's secret
manager. Specifically:

- [ ] `DATABASE_URL` (Neon production branch; pooled connection string)
- [ ] `REDIS_URL` (Upstash production database)
- [ ] `ANTHROPIC_API_KEY` (production org, separate from staging)
- [ ] `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
      `R2_PUBLIC_URL`
- [ ] `APP_URL = https://areyouagentic.com`
- [ ] `SESSION_SECRET`, `JWT_SECRET` (each `openssl rand -base64 32`)
- [ ] `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (client) for each
      app; matched `SENTRY_ENVIRONMENT=production`
- [ ] `METRICS_USERNAME`, `METRICS_PASSWORD` (long random password)
- [ ] `SENTRY_AUTH_TOKEN` in CI for source-map upload (Web)
- [ ] No secret values committed anywhere in the repo:

      ```bash
      git grep -nE 'sk-[a-zA-Z0-9_-]{20,}|aws_secret|service-role'
      ```

## 3. Infrastructure

- [ ] **Postgres (Neon):**
  - Production project created, separate from staging.
  - Point-in-time recovery enabled.
  - Daily snapshot retention ≥ 7 days.
  - Migrations applied: `pnpm --filter @areyouagentic/db prisma migrate deploy`.
- [ ] **Redis (Upstash):**
  - Production database created; TLS-only endpoint.
  - AOF persistence enabled.
- [ ] **R2 (Cloudflare):**
  - `areyouagentic-artifacts` bucket created.
  - Bucket versioning enabled.
  - Lifecycle rule: non-current versions deleted after 30 days.
  - Public access via the artifacts subdomain configured if required.
- [ ] **DNS:**
  - `areyouagentic.com` → Vercel.
  - `api.areyouagentic.com` → API host.
  - `artifacts.areyouagentic.com` → R2 public bucket.
  - HTTPS records active on all three; HSTS preload submitted if you want it.

## 4. Deploy

- [ ] Trigger **Deploy** workflow with `environment=production`. Confirm:
  - Tag pushed (`vX.Y.Z`).
  - Three images at `ghcr.io/<repo>/{api,worker,web}:vX.Y.Z`.
  - GitHub release created.
- [ ] **Web (Vercel):** auto-deploy succeeded or the new tag is promoted to
      production.
- [ ] **API (Railway/Fly.io):** service redeployed to the new tag.
      `curl https://api.areyouagentic.com/health` returns 200.
- [ ] **Worker (Railway/Fly.io):** service redeployed.
      `curl https://worker.areyouagentic.com:4001/health` returns 200.
      Minimum 2 instances behind autoscaler.

## 5. Smoke test

- [ ] `curl -X POST https://api.areyouagentic.com/api/analyze
       -H 'Content-Type: application/json'
       -d '{"url":"https://example.com"}'`
      returns 202 with a `jobId`.
- [ ] `curl https://api.areyouagentic.com/api/jobs/<jobId>` shows the job
      progressing through PENDING → RUNNING → COMPLETED within ~30s.
- [ ] `curl https://api.areyouagentic.com/api/reports/<reportId>` returns
      a report with a non-zero score.
- [ ] Frontend at `areyouagentic.com` accepts a URL and renders the report.
- [ ] Trigger a deliberate error (e.g. submit `data:text/html,foo`).
      Sentry captures the event in production project; PII fields are
      redacted in the event payload.

## 6. Observability

- [ ] `curl -u "$METRICS_USERNAME:$METRICS_PASSWORD" /api/metrics` returns
      JSON.
- [ ] Sentry project receives events from web, api, worker (use `app` tag).
- [ ] Log pipeline (Vercel logs / Railway / Fly.io) shows structured JSON,
      not pretty-printed pino.
- [ ] Request-id appears on every request and propagates web → api → worker
      (search a single id in all three log sources).

## 7. Rate limiting & abuse

- [ ] `POST /api/analyze` enforces 5/min and 20/day per IP (verify with a
      tight loop).
- [ ] Global API rate limit 30/min per IP behaves correctly.
- [ ] SSRF guard rejects `http://169.254.169.254/`,
      `http://localhost/`, `file:///etc/passwd`.

## 8. Backup verification

- [ ] Restore Neon snapshot to a throwaway branch, point a staging copy of
      the API at it, confirm queries return data.
- [ ] List R2 versions for at least one object; confirm both current and
      historic versions are accessible.

## 9. On-call & docs

- [ ] `docs/RUNBOOK.md` is current and reachable from the on-call rotation.
- [ ] At least two engineers can run the rollback procedure end-to-end.
- [ ] Sentry alert rules wired up:
  - new issue in production project → Slack `#oncall`
  - regression of a previously-resolved issue → Slack `#oncall`
  - high-volume issue (>50/hour) → page

## 10. Day-after

- [ ] First 24h: check `/api/metrics` `errorRate` ≤ baseline.
- [ ] First 24h: zero unexplained `byStatus.FAILED` spikes.
- [ ] First week: review Sentry issues — every distinct issue either has a
      fix queued or a "won't fix" rationale.
