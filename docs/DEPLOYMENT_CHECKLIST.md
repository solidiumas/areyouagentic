# Deployment checklist

This reflects the **actual beta deployment** of areyouagentic.com, not the
original aspirational plan. Items checked (`[x]`) were completed during the
beta launch; unchecked items are still open or deferred.

## Live beta architecture

| Component                          | Platform              | URL                                          |
| ---------------------------------- | --------------------- | -------------------------------------------- |
| Web (Next.js)                      | **Vercel**            | `https://areyouagentic.vercel.app`           |
| API (Fastify)                      | **Railway** (Docker)  | `https://api-production-6eca.up.railway.app` |
| Worker (BullMQ + Playwright + LLM) | **Railway** (Docker)  | internal                                     |
| Postgres                           | **Railway** managed   | internal `${{Postgres.DATABASE_URL}}`        |
| Redis                              | **Railway** managed   | internal `${{Redis.REDIS_URL}}`              |
| Artifacts (R2)                     | **deferred** for beta | —                                            |

Deploys are GitHub-driven: pushing to `main` rebuilds the Railway services
(from each app's Dockerfile) and the Vercel project. There is no GHCR /
tag-based Deploy workflow in the beta.

> **Lessons already baked into the Dockerfiles / config — don't regress these:**
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
>    `https://…` origin (Zod validates it as a URL; a bare host crashes the
>    API on boot) and must match the browser origin exactly.
> 5. Workspace libraries (`shared`, `db`, `analyzers`) build to `dist/` and
>    are imported as JS at runtime — they are no longer consumed as `.ts`.

## 1. Code & tests

- [x] `main` green on **CI** (lint, typecheck, build, test, Docker image
      builds for all three apps).
- [x] `pnpm audit` clean (rollup advisory pinned via `pnpm.overrides`).
- [x] CodeQL clean on `main`.
- [ ] No leftover `TODO: prod` / `// remove before launch`:

      ```bash
      git grep -nE 'TODO:.*prod|remove before launch'
      ```

- [x] `.env.example` lists every variable production reads.

## 2. Secrets

Set in the platform's variable manager (Railway per-service, Vercel project).

- [x] `DATABASE_URL` — Railway: `${{Postgres.DATABASE_URL}}` (api + worker)
- [x] `REDIS_URL` — Railway: `${{Redis.REDIS_URL}}` (api + worker)
- [x] `ANTHROPIC_API_KEY` — worker only (optional; LLM step skips if absent)
- [x] `APP_URL = https://areyouagentic.vercel.app` — api (CORS origin)
- [x] `NEXT_PUBLIC_API_URL = https://api-production-6eca.up.railway.app` —
      Vercel (baked in at build time → redeploy web after changing)
- [ ] `SESSION_SECRET`, `JWT_SECRET` — **removed from the codebase** (no code
      ever read them). Delete the values from the Railway api service; the
      no-account Stripe model doesn't need sessions either.
- [x] `METRICS_USERNAME`, `METRICS_PASSWORD` — api
- [ ] `SENTRY_DSN` (server) / `NEXT_PUBLIC_SENTRY_DSN` (client) +
      `SENTRY_ENVIRONMENT=production` — **deferred** (wire before wide launch)
- [ ] R2 (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
      `R2_BUCKET`, `R2_PUBLIC_URL`) — **deferred**; persist skips screenshot
      upload when unset
- [x] No secret values committed in the repo:

      ```bash
      git grep -nE 'sk-[a-zA-Z0-9_-]{20,}|aws_secret|service-role'
      ```

- [x] Postgres password rotated after it was exposed during setup (Railway
      Postgres → Config → Regenerate password; api + worker redeployed).

## 3. Infrastructure

- [x] **Postgres (Railway):** managed instance provisioned; schema applied
      with `prisma db push` against `DATABASE_PUBLIC_URL`.
  - [ ] Confirm Railway backups/retention policy for the DB plan in use.
  - [x] Move from `db push` to `prisma migrate deploy`: the init migration
        (`packages/db/prisma/migrations/0_init/`) is committed and the
        **Migrate** workflow (`.github/workflows/migrate.yml`) applies new
        migrations on push to `main`. Two one-time setup steps remain: - [ ] Add repo secret `PROD_DATABASE_URL` (Railway → Postgres →
        `DATABASE_PUBLIC_URL`) in GitHub → Settings → Secrets → Actions. - [ ] Baseline the existing beta DB (it predates the migration
        history): `DATABASE_URL=<DATABASE_PUBLIC_URL> pnpm --filter
@areyouagentic/db exec prisma migrate resolve --applied 0_init`
- [x] **Redis (Railway):** managed instance provisioned; reachable from api
      and worker (`/health` reports `redis: ok`).
- [ ] **R2 (Cloudflare):** deferred for beta (no screenshots in reports yet).
- [ ] **DNS:** deferred — beta runs on `*.vercel.app` / `*.up.railway.app`.
      For the custom domain later:
  - `areyouagentic.com` → Vercel; update `NEXT_PUBLIC_API_URL` if the API
    also moves to `api.areyouagentic.com`, and update API `APP_URL` to the
    new web origin (CORS).

## 4. Deploy

- [x] Push to `main` → Railway rebuilds api + worker from their Dockerfiles.
- [x] Push to `main` → Vercel rebuilds web (root dir `apps/web`,
      `vercel.json` drives install + `turbo` build).
- [x] **API:** `curl https://api-production-6eca.up.railway.app/health`
      returns `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`.
- [x] **Worker:** Railway shows the service online; it drains the queue
      (verified by the smoke test below reaching COMPLETED).

## 5. Smoke test

- [x] `POST /api/analyze {"url":"https://example.com"}` → 202 + `jobId`.
- [x] `GET /api/jobs/<jobId>` → PENDING → … → COMPLETED.
- [x] `GET /api/reports/<reportId>` → non-zero score (example.com: 51/100,
      grade D, 13 findings) **with a real LLM verdict + quick-wins**.
- [x] Frontend at `areyouagentic.vercel.app` accepts a URL and renders the
      report (manually verified in-browser).
- [ ] Trigger a deliberate error and confirm Sentry capture + PII redaction
      — **pending Sentry wiring**.

## 6. Observability

- [x] `/api/metrics` reachable with basic auth (`METRICS_USERNAME/PASSWORD`).
- [ ] Sentry receiving events from web, api, worker (tagged by `app`) —
      **pending**.
- [x] Railway / Vercel logs show structured JSON (pino), not pretty-print.
- [ ] Confirm request-id propagates web → api → worker (search one id across
      all three log sources).

## 7. Rate limiting & abuse

- [x] `POST /api/analyze` enforces 5/min + 20/day per IP (code-reviewed;
      the CI integration test is skipped on CI but runs locally).
- [x] Global API rate limit 30/min per IP.
- [ ] Re-verify SSRF guard against the live API: `http://169.254.169.254/`,
      `http://localhost/`, `file:///etc/passwd` are all rejected.
- [ ] Verify network-layer egress blocking on the **worker** host (deny
      169.254.169.254, RFC1918, loopback): the in-process SSRF guards can't
      fully close the DNS-rebinding TOCTOU window — SECURITY.md names this
      firewall as the required backstop. Check what Railway private
      networking actually blocks and document the result here.
- [ ] Enable Turnstile in production (`TURNSTILE_SECRET_KEY` on the api,
      `NEXT_PUBLIC_TURNSTILE_SITE_KEY` on Vercel + web redeploy) — it is
      wired but off by default.

## 8. Backup verification

- [ ] Confirm Railway Postgres backup cadence for the current plan; take a
      manual snapshot before any risky migration.
- [ ] (When R2 is enabled) verify object versions are retrievable.

## 9. On-call & docs

- [x] `docs/RUNBOOK.md` present.
- [ ] Update RUNBOOK with the **actual** Railway/Vercel topology and the
      Prisma-client-copy / CORS / password-rotation gotchas above.
- [ ] At least one more person can run a Railway rollback (redeploy previous
      deployment) end-to-end.
- [ ] Sentry alert rules (after Sentry is wired): new prod issue → notify;
      regression → notify; high-volume (>50/h) → page.

## 10. Day-after

- [ ] First 24h: `/api/metrics` `errorRate` ≤ baseline.
- [ ] First 24h: no unexplained `byStatus.FAILED` spikes.
- [ ] First week: every distinct Sentry issue (once wired) has a fix queued
      or a "won't fix" rationale.

## Top follow-ups before a wider (non-beta) launch

1. **Sentry** — error tracking is the biggest gap; wire server + client DSNs.
2. **Versioned migrations** — done in code (init migration + Migrate
   workflow); remaining: add the `PROD_DATABASE_URL` secret and run the
   one-time `migrate resolve --applied 0_init` baseline (see §3).
3. **Custom domain + DNS** — `areyouagentic.com`, then update `APP_URL` +
   `NEXT_PUBLIC_API_URL`.
4. **R2** — re-enable screenshots in reports if they add user value.
5. **Backups** — confirm/raise Railway Postgres retention; rehearse a restore.
