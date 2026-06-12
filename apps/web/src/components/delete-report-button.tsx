'use client';

import * as React from 'react';
import Link from 'next/link';
import { Loader2, Trash2 } from 'lucide-react';

import { ApiClientError, deleteReport } from '@/lib/api';
import { clearDeleteTokenForReport, getDeleteTokenForReport } from '@/lib/delete-token';
import { Button } from '@/components/ui/button';

type Status = 'idle' | 'confirming' | 'deleting' | 'deleted' | 'error';

/**
 * Self-service deletion control. Renders only for the visitor who submitted the
 * analysis — i.e. the one holding the one-time delete token in sessionStorage.
 * Everyone else (anyone with the public link) sees nothing.
 */
export function DeleteReportButton({ reportId }: { reportId: string }) {
  const [token, setToken] = React.useState<string | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const [status, setStatus] = React.useState<Status>('idle');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setMounted(true);
    setToken(getDeleteTokenForReport(reportId));
  }, [reportId]);

  // Avoid hydration mismatch: nothing renders until we've read sessionStorage.
  if (!mounted || (!token && status !== 'deleted')) return null;

  if (status === 'deleted') {
    return (
      <div className="mt-12 rounded-lg border border-border/60 bg-muted/30 p-4 text-sm">
        <p className="font-medium text-foreground">Report deleted.</p>
        <p className="mt-1 text-muted-foreground">
          The report and its stored data have been removed.{' '}
          <Link href="/" className="underline underline-offset-2 hover:text-foreground">
            Analyze another site
          </Link>
          .
        </p>
      </div>
    );
  }

  async function onDelete() {
    if (!token) return;
    setStatus('deleting');
    setError(null);
    try {
      await deleteReport(reportId, token);
      clearDeleteTokenForReport(reportId);
      setToken(null);
      setStatus('deleted');
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.status === 403
            ? 'This delete link is no longer valid.'
            : err.status === 404
              ? 'This report no longer exists.'
              : err.message
          : 'Something went wrong. Please try again.';
      setError(msg);
      setStatus('error');
    }
  }

  return (
    <section
      aria-labelledby="delete-heading"
      className="mt-12 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
    >
      <h2 id="delete-heading" className="text-sm font-semibold text-foreground">
        Delete this report
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        You submitted this analysis, so you can delete it. This removes the report and its stored
        data immediately and cannot be undone. The delete option is only available from this
        browser.
      </p>

      {status === 'confirming' ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-foreground">Delete permanently?</span>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            Yes, delete
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setStatus('idle')}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-3">
          <Button
            variant="destructive"
            size="sm"
            disabled={status === 'deleting'}
            onClick={() => setStatus('confirming')}
          >
            {status === 'deleting' ? (
              <>
                <Loader2 className="animate-spin" aria-hidden /> Deleting…
              </>
            ) : (
              <>
                <Trash2 aria-hidden /> Delete report
              </>
            )}
          </Button>
        </div>
      )}

      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
