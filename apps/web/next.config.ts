import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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

export default config;
