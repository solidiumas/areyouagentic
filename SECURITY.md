# Security policy

## Reporting a vulnerability

Email **security@areyouagentic.com** with:

- A description of the issue and the impact you believe it has.
- Steps to reproduce — proof-of-concept code, request payloads, or URLs.
- The version (tag or commit SHA) you tested against.

Please **do not** open a public GitHub issue for security problems. We try
to acknowledge within two business days and fix critical issues within ten.
Responsible disclosure is appreciated and we will credit you in the release
notes unless you ask us not to.

## Scope

In scope:

- The web app at `areyouagentic.com` and its API.
- Any code in this repository.
- Docker images we publish under `ghcr.io/<org>/<app>`.

Out of scope:

- Third-party services we depend on (Anthropic, Cloudflare, Vercel, Neon,
  Upstash, Sentry). Report directly to those providers.
- Social-engineering or physical attacks against the team.
- Volumetric DoS — we run behind providers that handle that for us.

## Supported versions

Only the latest tagged release receives security fixes. Older releases are
expected to be replaced rather than patched.

## What we do

- **TLS everywhere** between the user, the edge, the API, the worker, and
  every backing service. No plaintext links.
- **Strict CSP, HSTS, X-Frame-Options, Referrer-Policy** on every response
  from the API and web app (see `apps/api/src/plugins/helmet.ts` and
  `apps/web/next.config.ts`).
- **Rate limiting** on `POST /api/analyze` (5/min, 20/day per IP) and a
  global 30/min cap on the API surface.
- **SSRF guards** on every submitted URL: protocol allowlist (http/https
  only), credential rejection, hostname blocklist, IP-literal blocking for
  loopback / private / link-local / reserved ranges.
- **Body limits** on every endpoint (10 KiB on `/api/analyze`).
- **Structured error envelopes** so 500 responses never leak stack traces
  to clients (`apps/api/src/plugins/errorHandler.ts`).
- **PII scrubbing in Sentry** via `beforeSend` — Authorization/Cookie
  headers, request bodies, IP addresses, emails, and query strings are
  redacted before events leave the process.
- **Secrets in env only** — never committed. CI runs `pnpm audit --prod`
  weekly plus on every PR; CodeQL (security-extended suite) runs weekly.
- **Non-root containers** with `HEALTHCHECK` in every Dockerfile.
- **Minimal IAM** — worker has R2 write to its bucket only; API has DB
  read/write but no admin role; web has no DB/Redis access at all.

## What's risky and how we contain it

- The worker fetches arbitrary user-supplied URLs. We **never** run those
  fetches with the worker's network reachable to internal services (egress
  is restricted to the public internet at the platform level), and SSRF
  validation runs both pre-enqueue (API) and pre-fetch (worker).
- We run Anthropic prompts against scraped content. Prompt injection is
  assumed; treat any model output as untrusted text and never execute it
  or expand variables from it.

## Dependencies

`pnpm audit --audit-level=high --prod` runs in CI. If a high or critical
advisory drops, expect a same-week patch PR.

## Backups & disaster recovery

See `docs/RUNBOOK.md` for backup cadence, restore procedure, and the
incident response runbook.
