# Security Changelog

Dated log of security-relevant changes. Newest first. See
[SECURITY.md](SECURITY.md) for the threat model and overall posture.

## 2026-06-12 — P2: hardening (CORS, JSON-LD, prompt-injection, captcha)

### Added

- **Optional Cloudflare Turnstile gate** on `POST /api/analyze`. Off by
  default; enabled by setting `TURNSTILE_SECRET_KEY` (API, server-side
  siteverify, fails closed) + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (web widget).
  The CSP is widened to allow Cloudflare only when the site key is set.
  `siteverify` covered by 5 unit tests.
- **`serializeJsonLd`** (in `@areyouagentic/shared`) escapes `<`/`>`/`&` and
  the U+2028/U+2029 separators so inline JSON-LD blocks can't break out of
  their `<script>` element. Used in `layout.tsx` / `page.tsx`. 4 unit tests.

### Changed

- **Prompt-injection hardening.** The analyzer payload sent to the LLM
  (which includes website-controlled `pageTitle` / `finalUrl` / finding
  titles) is now wrapped in explicit untrusted-data markers via
  `buildAnalysisUserMessage`, and the system prompt instructs the model to
  treat that block as data, never as instructions, with the deterministic
  scores authoritative. `SYSTEM_PROMPT_VERSION` bumped. 5 unit tests.
- **CORS `credentials: false`.** The API is cookie-free (ownership uses a
  bearer-style delete token), so cross-origin credentials are never needed.

## 2026-06-11 — P1: report exposure & privacy

### Added

- **Self-service report deletion.** A one-time delete token is issued to
  the submitter at analysis time (only its SHA-256 hash is stored, on the
  job); `DELETE /api/reports/:id` requires the plaintext token. The report
  page shows a **Delete report** control to the submitter (token carried in
  `sessionStorage`). The 90-day retention cron remains the fallback.
  Possession of the public report link alone cannot delete it.

### Changed

- **Report ids are now cuid2** (`@default(cuid(2))`) — cryptographically
  random and unguessable. The report id is the only access control on a
  public-but-unlisted report; a v1 cuid (timestamp + counter) was weakly
  predictable. Legacy ids still resolve.
- **Secret-bearing URL params are redacted before storage/display.**
  `maskSensitiveUrl` (in `@areyouagentic/shared`) replaces the values of
  `token`/`secret`/`password`/`auth`/`sig`/… params (and strips embedded
  credentials) before a URL is written to `AnalysisJob.url` /
  `Report.finalUrl` or sent to the LLM. The dedup key (`normalizedUrl`) and
  the worker's fetch payload keep real values, so analysis still works and
  distinct tokens never collapse to one report.
- **Privacy page** reworded: reports are "public but unlisted", the
  Anthropic disclosure now matches the code (a structured summary — scores,
  finding titles, page title, final URL — not raw page text), and the
  data-deletion section points at the real delete control.

### Fixed

- **Broken GitHub / SECURITY.md links.** The footer, privacy page, and the
  `SECURITY.md` advisory URL pointed at a non-existent `areyouagentic` org.
  They now point at `github.com/solidiumas/areyouagentic`, so the
  vulnerability-reporting channel actually resolves.

## 2026-06-11 — P0: render-stage SSRF gate

### Fixed

- **Critical: SSRF via the Playwright render stage.** The render stage
  navigated a headless browser directly at the user URL (`page.goto`),
  bypassing every `safeFetch` SSRF defense — Chromium did its own DNS
  resolution and followed redirects automatically, so DNS-rebinding,
  redirect-to-metadata, and JavaScript-driven `fetch()` to internal hosts
  were all reachable and could be exfiltrated via the stored screenshot.
  Closed by the new `apps/worker/src/lib/safeBrowsing.ts`:
  - `assertNavigableUrl` validates + DNS-resolves the target before
    `page.goto`; a directly-private or rebinding target fails fast and
    permanently.
  - `installSsrfGuard` registers a `context.route('**/*')` handler that
    re-validates every browser request (main navigation, redirect hops,
    JS-driven sub-resources) and aborts anything in a blocked range.
  - Covered by `safeBrowsing.test.ts` (14 cases).
- **Internal-network error oracle.** `safeFetch` error messages (which
  named the resolved private IP) were stored as the job `errorMessage`
  and shown in the UI, letting a user map internal DNS/IPs. The fetch and
  render stages now surface a generic, leak-free message via
  `safeFetchUserMessage`; the detail stays in the server log only.

### Added

- **Deployment hardening note** in `SECURITY.md`: the worker host must
  block outbound traffic to internal ranges (metadata, RFC1918,
  loopback, link-local) as defense-in-depth behind the app-layer gates.

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
