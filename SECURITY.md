# Security Policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in
[areyouagentic.com](https://areyouagentic.com) or this repository, please
**do not open a public GitHub issue**. Instead, report it privately:

- Open a private security advisory at
  [github.com/solidiumas/areyouagentic/security/advisories/new](https://github.com/solidiumas/areyouagentic/security/advisories/new),
  or
- Email `security@areyouagentic.com` (PGP key on request).

Please include:

- A description of the issue and the impact you believe it has.
- Step-by-step reproduction (or a proof-of-concept request / URL).
- Any logs, request IDs, or timestamps that help us trace the activity.

We will acknowledge receipt within **2 business days** and aim to provide a
fix or remediation plan within **30 days** for high-severity issues. We do
not currently run a paid bounty program; we are happy to credit reporters in
the changelog with their consent.

Please do **not** run automated scanners that generate significant load
against the public API. We treat the published `validateAnalyzableUrl` and
`safeFetch` modules as the in-scope SSRF surface; please target your testing
there.

## Threat model

This is what we built the service to defend against. Anything not listed
here is _out of scope_ (which doesn't mean we don't care — just that we
haven't designed mitigations for it).

### In scope

1. **SSRF via the analyzer pipeline.** A user submits a URL; the worker
   both _fetches_ it (`safeFetch`) and _renders_ it in a headless browser
   (Playwright). An attacker could try to coerce either path into reaching
   internal services (cloud metadata, RFC1918 networks, loopback) directly
   or via DNS-rebinding / redirect chains, including JavaScript-driven
   sub-requests made by a hostile page during rendering.
2. **Unauthenticated abuse of the public API.** Rate-limit bypass, mass
   enqueueing of jobs, denial of service of the analysis queue.
3. **Injection into stored reports.** Arbitrary URLs become part of stored
   reports rendered on the report page; we must not allow stored XSS via
   `finalUrl`, `pageTitle`, finding text, etc.
4. **Secrets leakage.** The Anthropic API key is held only by the worker
   service. The API and web services must not have access to it.
5. **PII over-collection.** We collect as little as possible and delete
   reports after 90 days.

### Out of scope

- Compromise of the underlying VPC / Postgres / Redis at the infra layer.
  We trust the deployment platform's primitives.
- Denial of service by a determined attacker with significant resources;
  we mitigate, not eliminate, abuse.
- Phishing or social-engineering of operators.
- Vulnerabilities in third-party dependencies we have not yet patched —
  see _Known limitations_ below.

## Mitigations in place

### SSRF defense (the big one)

The worker reaches a target over **two** code paths — `safeFetch` (HTML +
robots/sitemap probes) and the Playwright **render** stage. Both are gated.

User-submitted URLs go through these independent gates before the worker
fetches anything:

1. **URL-shape validation** —
   [`validateAnalyzableUrl`](packages/shared/src/schemas/url.ts)
   rejects, before any network activity:
   - Non-`http(s)` protocols (`file:`, `ftp:`, `javascript:`, `data:`, …).
   - URLs with embedded credentials (`user:pass@host`).
   - All literal loopback IPs (`127.0.0.0/8`, `::1`).
   - Private networks (`10/8`, `172.16/12`, `192.168/16`, IPv6 ULA `fc00::/7`).
   - CGNAT (`100.64.0.0/10`).
   - Link-local (`169.254.0.0/16`, including the AWS metadata IP
     `169.254.169.254`).
   - `0.0.0.0`, multicast, broadcast, all other reserved ranges.
   - IPv4 obfuscation: decimal (`http://2130706433`), hex (`http://0x7f.0.0.1`),
     octal, and short-form notations.
   - IPv4-mapped IPv6 (`http://[::ffff:127.0.0.1]/`).

   Each of these has a unit test in [`url.test.ts`](packages/shared/src/schemas/url.test.ts).

2. **DNS resolution gate** —
   [`resolveHostnameSafely`](apps/worker/src/lib/safeFetch.ts)
   resolves the hostname via `dns.lookup({ all: true })` and rejects if **any**
   returned A/AAAA record is in a blocked range (see
   [`classifyIpString`](packages/shared/src/schemas/url.ts)). This defeats
   DNS-rebinding (`evil.example.com` → `127.0.0.1`) and multi-record
   poisoning (one public IP, one private IP — same hostname).

3. **Per-hop redirect validation** —
   [`safeFetch`](apps/worker/src/lib/safeFetch.ts) uses `redirect: 'manual'`
   and re-runs both gates against each `Location` header. A 302 to
   `http://169.254.169.254/` from an otherwise-safe URL is blocked.

Additional defenses in `safeFetch`:

- Hard cap on response size (default 10 MB).
- Per-hop request timeout (default 15 s).
- Maximum 5 redirects before aborting.

4. **Render-stage guard** —
   [`safeBrowsing`](apps/worker/src/lib/safeBrowsing.ts) applies the same two
   gates to the headless browser. Playwright does its own DNS resolution and
   follows redirects automatically, so the `safeFetch` gates do **not** cover
   it. Before navigation, `assertNavigableUrl` runs URL-shape validation +
   DNS classification. During navigation, `installSsrfGuard` registers a
   `context.route('**/*')` handler that re-validates **every** request the
   browser makes — the main document, each redirect hop, and every
   JavaScript-driven sub-resource (`fetch`/`XHR`/`<img>`/…) — and aborts any
   request whose URL or resolved address falls in a blocked range. A blocked
   navigation becomes a `PermanentJobError` with a generic message; the
   resolved internal address is logged server-side only, never returned to
   the user (so the error path is not an internal-network oracle). Covered by
   [`safeBrowsing.test.ts`](apps/worker/src/lib/safeBrowsing.test.ts).

**Known TOCTOU limitation:** between `dns.lookup` and the subsequent
`fetch`, Node will resolve DNS again. A motivated attacker who controls a
public DNS resolver and serves a _different_ answer on the second lookup
could in principle bypass the gate. We do not pin the IP because Node's
built-in `fetch` does not support custom resolvers. The URL-validator
catches _literal_ private addresses regardless, so the realistic attack
surface is "hostname that returns different DNS answers within ms" —
a high-effort attack against a low-value target.

### Public API

- All endpoints validated with **Zod** at the request boundary
  ([`packages/shared/src/schemas/api.ts`](packages/shared/src/schemas/api.ts)).
- Request body limit: **10 KB** per request (also enforced at the route
  level on `POST /api/analyze`).
- Path params validated against the cuid/cuid2 format _before_ any DB
  query, so malformed IDs cost a regex match, not a query. **Report ids are
  cuid2** (`@default(cuid(2))`) — cryptographically random and unguessable,
  since the id is the only access control on a public-but-unlisted report.
- **Secret redaction.** `maskSensitiveUrl` redacts secret-bearing query
  params (`token`, `secret`, `auth`, `sig`, …) and embedded credentials
  before a URL is persisted (`AnalysisJob.url`, `Report.finalUrl`) or sent
  to the LLM. The dedup key (`normalizedUrl`) and the worker's fetch payload
  keep real values.
- **Self-service deletion.** `DELETE /api/reports/:id` requires the
  one-time delete token issued at submit (only its SHA-256 hash is stored);
  the token is compared in constant time. Possession of the public report
  link alone is not sufficient.
- **Rate limiting** (Redis-backed, per IP, via `@fastify/rate-limit`):
  - Global: 30 req/min/IP.
  - `POST /api/analyze`: 5 req/min/IP **and** 20 req/day/IP. Both must pass.
- **Error envelope** is consistent; production responses never include
  stack traces or `err.message` from unhandled errors.
- **CORS** in production is locked to the configured `APP_URL`.

Health checks (`GET /health`) are exempt from rate-limiting.

### Frontend (Next.js)

- **Strict Content Security Policy** in [`next.config.ts`](apps/web/next.config.ts):
  `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`. JSON-LD
  structured-data blocks require `script-src 'self' 'unsafe-inline'`; we
  accept that since the site has no third-party scripts to expand the
  blast radius.
- **HSTS** (`max-age=63072000; includeSubDomains; preload`) in production
  only; _not_ set in development to avoid pinning `localhost` to https.
- `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`.

### Backend (Fastify)

- `@fastify/helmet` registered globally with a tight default CSP for the
  JSON-only API (`default-src 'none'`, `frame-ancestors 'none'`).
- Strict-Transport-Security set by helmet defaults.

### Secrets

- All env vars validated with **Zod** at startup; the process refuses to
  boot on a half-configured env
  ([`apps/api/src/lib/env.ts`](apps/api/src/lib/env.ts),
  [`apps/worker/src/lib/env.ts`](apps/worker/src/lib/env.ts)).
- **`ANTHROPIC_API_KEY` is loaded only by the worker** — the API service
  does not import it. This isolates the most-sensitive credential from the
  public-facing surface.
- The pino logger has a redact list (`authorization`, `cookie`,
  `set-cookie`, `*.password`, `*.token`, `*.apiKey`) so a stray
  `logger.info(req.headers)` cannot leak credentials.
- `.env`, `.env.local`, `.env.*.local` are git-ignored;
  [`.env.example`](.env.example) is the canonical, secret-free template.

### Database

- All queries go through Prisma (parameterized; no raw SQL except a
  read-only `SELECT 1` health probe).
- `Report` rows are immutable once written; the API only ever reads them.
- **Retention:** [`apps/worker/src/retention.ts`](apps/worker/src/retention.ts)
  deletes `AnalysisJob` rows (cascading to `Report`) older than 90 days.
  Intended to run on a daily cron from the deployment platform:
  `pnpm --filter @areyouagentic/worker retention`.

### Worker isolation

- The worker runs as a separate process with its own env file. The
  Anthropic API key is provisioned only there.
- BullMQ jobs run inside a wall-clock `JOB_TIMEOUT_MS` ceiling (default
  90 s) so a hostile target cannot hang a worker indefinitely.
- Permanent (non-retryable) failures surface as `PermanentJobError` so
  bad-URL jobs don't burn the BullMQ retry budget.

### Deployment hardening (required for the worker)

The app-layer SSRF gates above are the primary control, but the worker
host **must** also block outbound traffic to internal ranges as
defense-in-depth — this is what backstops the residual DNS-TOCTOU window
and any future code path that forgets a gate. On the platform that runs
`apps/worker` (Railway / Fly.io / container host), deny egress to:

- `169.254.0.0/16` (incl. the cloud metadata IP `169.254.169.254`)
- `127.0.0.0/8`, `::1`
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`
- IPv6 ULA `fc00::/7` and link-local `fe80::/10`

R2 screenshot storage: the bucket must **not** be publicly listable, and
object keys are unguessable (`screenshots/<jobId>.png`). Prefer serving
screenshots via signed URLs rather than a world-readable bucket.

### Dependencies

- **Dependabot** keeps `pnpm` and GitHub Actions dependencies patched
  weekly; runtime patch/minor updates are grouped to keep PR volume sane
  ([`.github/dependabot.yml`](.github/dependabot.yml)).
- `pnpm.overrides` in [`package.json`](package.json) pin transitive deps
  that had open advisories the upstream hadn't pulled yet (`fast-uri`,
  `esbuild`, `postcss`). Re-run `pnpm audit` after upstream releases to
  see if any overrides can be dropped.

## Known limitations

These are weaknesses we have _not_ mitigated, listed openly so reporters
don't waste time and operators know what to watch for.

- **Bot/CAPTCHA gate is opt-in.** Rate limiting is per-IP, which a
  determined attacker can rotate around. A Cloudflare Turnstile gate on
  `POST /api/analyze` is wired in (`apps/api/src/lib/turnstile.ts` +
  the `TurnstileWidget`) but **off by default** — it activates only when
  `TURNSTILE_SECRET_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY` are set. Enable
  it in production if organized abuse appears. When enabled it fails closed.
- **No read-only DB role.** All services connect with the same Postgres
  user. Splitting into a writer (API + worker) and a reader (the
  `GET /api/reports/:id` handler could use a separate role) is a sensible
  follow-up but not done.
- **DNS TOCTOU.** See the SSRF section above.
- **Vite dev-server advisory (GHSA-4w7w-66w2-5vf9).** The path-traversal
  in Vite ≤6.4.1 affects only dev servers exposed via `--host`. We do not
  expose `vitest --host`, so the risk is bounded to local dev machines.
  The fix requires upgrading to Vitest ≥3, which the project will pick up
  via Dependabot.

## Security changelog

See [CHANGELOG-security.md](CHANGELOG-security.md) for a dated log of
security-relevant changes.
