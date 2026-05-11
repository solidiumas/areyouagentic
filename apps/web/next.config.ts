import path from 'node:path';
import type { NextConfig } from 'next';

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
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
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
    const withSentryConfig = (mod as unknown as { withSentryConfig: (c: NextConfig, opts: Record<string, unknown>) => NextConfig }).withSentryConfig;
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
