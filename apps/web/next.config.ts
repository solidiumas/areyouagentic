import path from 'node:path';
import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Content Security Policy.
 *
 * - `script-src 'self' 'unsafe-inline'` allows the JSON-LD blocks we inline in
 *   layout.tsx / page.tsx via `<script type="application/ld+json">`. Those
 *   never execute (they're structured data), but the CSP parser doesn't know
 *   that — so we accept the cost of `'unsafe-inline'` for scripts. There is no
 *   third-party JS on this site to widen the blast radius.
 * - `style-src 'self' 'unsafe-inline'` covers Next's runtime style injection.
 * - `connect-src` permits same-origin XHRs (job polling, report fetch) plus the
 *   configured API URL when the API lives on a different host in prod.
 * - `frame-ancestors 'none'` matches X-Frame-Options: DENY (defense in depth).
 */
function buildCsp(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  // Cloudflare Turnstile (opt-in): only widen the policy to allow its script +
  // iframe when a site key is configured. Default deploys keep the tighter CSP.
  const turnstileEnabled = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  const cf = 'https://challenges.cloudflare.com';

  const scriptSrc = ["'self'", "'unsafe-inline'", turnstileEnabled ? cf : null]
    .filter(Boolean)
    .join(' ');
  const connectSrc = ["'self'", apiUrl, turnstileEnabled ? cf : null].filter(Boolean).join(' ');
  const frameSrc = ["'self'", turnstileEnabled ? cf : null].filter(Boolean).join(' ');

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `frame-src ${frameSrc}`,
    "object-src 'none'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
    "font-src 'self' fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    `connect-src ${connectSrc}`,
    'upgrade-insecure-requests',
  ].join('; ');
}

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output produces a self-contained server.js bundle plus a
  // minimal node_modules — the Dockerfile copies just those into the runtime
  // image, dropping image size by an order of magnitude.
  output: 'standalone',
  // Treat the shared package as transpilable so workspace `.ts` sources
  // resolve without a separate build step.
  transpilePackages: ['@areyouagentic/shared'],
  // Pin the workspace root so Next stops complaining about "multiple lockfiles"
  // when run from a worktree that shares a lockfile with the parent repo.
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  webpack: (cfg) => {
    // Shared workspace packages are TS with NodeNext-style imports
    // (`./foo.js` resolving to `./foo.ts`). Teach webpack the same trick.
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.extensionAlias = {
      ...(cfg.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    return cfg;
  },
  async headers() {
    const baseHeaders = [
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
      },
      { key: 'Content-Security-Policy', value: buildCsp() },
    ];

    // HSTS only in production. Setting it in dev would lock the browser to
    // https://localhost forever for that hostname, which breaks plain-HTTP
    // local development.
    if (isProd) {
      baseHeaders.push({
        key: 'Strict-Transport-Security',
        // 2 years, include subdomains, preload-eligible
        value: 'max-age=63072000; includeSubDomains; preload',
      });
    }

    return [
      { source: '/:path*', headers: baseHeaders },
      {
        source: '/llms.txt',
        headers: [{ key: 'Content-Type', value: 'text/plain; charset=utf-8' }],
      },
    ];
  },
};

// Wrap with `withSentryConfig` when `@sentry/nextjs` is installed and a DSN
// is configured. We resolve the wrapper lazily so the app still builds in
// environments that haven't installed Sentry yet (local dev, CI without
// SENTRY_AUTH_TOKEN, etc.).
async function wrapWithSentry(cfg: NextConfig): Promise<NextConfig> {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN && !process.env.SENTRY_DSN) return cfg;
  try {
    const mod = await import('@sentry/nextjs');
    const withSentryConfig = (
      mod as unknown as {
        withSentryConfig: (c: NextConfig, opts: Record<string, unknown>) => NextConfig;
      }
    ).withSentryConfig;
    return withSentryConfig(cfg, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // Source maps go up only when an auth token is provided.
      widenClientFileUpload: true,
      disableLogger: true,
    });
  } catch {
    return cfg;
  }
}

export default wrapWithSentry(config);
