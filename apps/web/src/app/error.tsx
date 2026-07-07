'use client';

/**
 * Route-level error boundary. Without this, any server-component throw (API
 * down, unexpected response shape) surfaces as Next's unstyled "Application
 * error" page. The digest is Next's server-side correlation id — surfacing it
 * gives support something to grep for.
 */
import * as Sentry from '@sentry/nextjs';
import Link from 'next/link';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="container max-w-xl py-20 text-center">
      <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Error</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">Something went wrong</h1>
      <p className="mt-3 text-muted-foreground">
        We couldn&rsquo;t load this page. It&rsquo;s likely temporary — please try again.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Reference: <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
      <div className="mt-8 flex justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}
