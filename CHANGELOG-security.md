# Security Changelog

Dated log of security-relevant changes. Newest first. See
[SECURITY.md](SECURITY.md) for the threat model and overall posture.

## 2026-05-11 — Hardening pass

### Added

- **DNS-resolution gate against SSRF / DNS-rebinding.** The new
  `resolveHostnameSafely` helper in `apps/worker/src/lib/safeFetch.ts`
  resolves the target hostname through `dns.lookup({ all: true })` and
  rejects the request if **any** A/AAAA record points at a blocked range
  (loopback, RFC1918, link-local, multicast, AWS metadata, …).
- **`safeFetch` helper** with per-hop SSRF re-validation, `redirect: 'manual'`,
  a 10 MB response size cap, a 15 s timeout per hop, and a 5-redirect
  ceiling. Future stages (`fetch`, `render`) should use this instead of
  calling `fetch` directly.
- **`classifyIpString` export** in `@areyouagentic/shared` so the worker's
  DNS gate and the URL validator share one IP-classification source of
  truth. Covered by 9 new test cases.
- **CSP** on the Next.js frontend (was previously unset).
  `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`,
  `upgrade-insecure-requests`. JSON-LD blocks require `'unsafe-inline'` on
  scripts; the site has no third-party JS to widen impact.
- **HSTS** in production: `max-age=63072000; includeSubDomains; preload`.
  Not set in development to avoid pinning `localhost` to https.
- **Retention job.** `apps/worker/src/retention.ts` deletes
  `AnalysisJob` rows (cascading to `Report`) older than 90 days. Run
  daily via `pnpm --filter @areyouagentic/worker retention`. Configurable
  via `RETENTION_DAYS`.
- **Dependabot** config (`.github/dependabot.yml`) for weekly grouped
  npm updates and monthly GitHub Actions updates.
- **`SECURITY.md`** at repo root documenting threat model, mitigations,
  reporting process, and known limitations.

### Changed

- **`ANTHROPIC_API_KEY` removed from the API service's env schema.** Only
  the worker process can hold the key now. Splits the most-sensitive
  credential off the public-facing surface. Updated `.env.example` to
  call out that the key is worker-only.
- **Path-param validation tightened.** `GET /api/jobs/:id` and
  `GET /api/reports/:id` now validate against the cuid format
  (`/^c[a-z0-9]{20,32}$/`) before hitting the database. Malformed ids
  return 400 instead of 404.
- **Privacy policy** updated to disclose the 90-day retention window, log
  retention (30 days), redaction policy, and the third-party
  (Anthropic API) flow.
- **`Permissions-Policy`** extended with `interest-cohort=()` to opt out
  of FLoC / Topics tracking.

### Fixed (dependency advisories)

- `fast-uri ≤3.1.0` (CVE-equivalent: path traversal via percent-encoded
  dot segments) — fixed via `pnpm.overrides` pinning to `>=3.1.2`.
- `fast-uri ≤3.1.1` (host confusion via percent-encoded authority
  delimiters) — same override.
- `esbuild ≤0.24.2` (dev-server request smuggling) — fixed via override
  to `>=0.25.0`.
- `postcss <8.5.10` (XSS via unescaped `</style>` in stringify) — fixed
  via override to `>=8.5.10`.

### Known issue carried forward

- `vite ≤6.4.1` advisory (GHSA-4w7w-66w2-5vf9) — affects only the dev
  server when exposed via `--host`. Vitest 2.x pins vite to 5.x, so the
  fix requires a major Vitest bump. Tracked for Dependabot.
