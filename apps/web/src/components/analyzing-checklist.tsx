'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Circle, Loader2, AlertTriangle, Clock } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ApiClientError, getJobStatus } from '@/lib/api';
import type { JobStatus, JobStatusResponse } from '@areyouagentic/shared';

const POLL_INTERVAL_MS = 1500;
const STALE_PROGRESS_WARNING_MS = 60_000;

/**
 * Visible analyzer steps. We map a 0–100 progress value into a step index,
 * so the worker only needs to report numeric progress — which is what BullMQ
 * already gives us. The threshold is the *minimum* progress at which a step
 * becomes "active"; the previous step flips to "done".
 */
const STEPS = [
  { id: 'fetch-robots', label: 'Fetching robots.txt…', threshold: 0 },
  { id: 'llms-txt', label: 'Looking for llms.txt…', threshold: 15 },
  { id: 'render', label: 'Rendering page…', threshold: 30 },
  { id: 'analyze', label: 'Analyzing structure…', threshold: 55 },
  { id: 'recommend', label: 'Asking Claude for recommendations…', threshold: 80 },
] as const;

type StepState = 'pending' | 'active' | 'done';

function deriveStepStates(status: JobStatus, progress: number): StepState[] {
  if (status === 'COMPLETED') return STEPS.map(() => 'done');
  if (status === 'PENDING') return STEPS.map((_, i) => (i === 0 ? 'active' : 'pending'));
  // RUNNING — find the latest threshold passed.
  let activeIndex = 0;
  STEPS.forEach((step, i) => {
    if (progress >= step.threshold) activeIndex = i;
  });
  return STEPS.map((_, i) => {
    if (i < activeIndex) return 'done';
    if (i === activeIndex) return 'active';
    return 'pending';
  });
}

export function AnalyzingChecklist({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [job, setJob] = React.useState<JobStatusResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [stalled, setStalled] = React.useState(false);

  // Track when progress last *changed* so we can warn the user if the worker
  // appears stuck. We compare the last-seen progress, not the timestamp.
  const lastProgressRef = React.useRef<{ value: number; at: number }>({
    value: -1,
    at: Date.now(),
  });

  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const tick = async () => {
      try {
        const next = await getJobStatus(jobId, { signal: controller.signal });
        if (cancelled) return;

        setJob(next);
        setError(null);

        const value = next.progress ?? (next.status === 'COMPLETED' ? 100 : 0);
        const last = lastProgressRef.current;
        if (value !== last.value) {
          lastProgressRef.current = { value, at: Date.now() };
          setStalled(false);
        } else if (Date.now() - last.at > STALE_PROGRESS_WARNING_MS && next.status !== 'COMPLETED') {
          setStalled(true);
        }

        if (next.status === 'COMPLETED' && next.reportId) {
          router.replace(`/report/${encodeURIComponent(next.reportId)}`);
          return;
        }
      } catch (err) {
        if (cancelled || (err as Error).name === 'AbortError') return;
        if (err instanceof ApiClientError && err.status === 404) {
          setError('This job no longer exists. It may have expired.');
          return;
        }
        setError(err instanceof ApiClientError ? err.message : 'Lost connection. Retrying…');
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(id);
    };
  }, [jobId, router]);

  const status: JobStatus = job?.status ?? 'PENDING';
  const progress = job?.progress ?? (status === 'COMPLETED' ? 100 : 0);
  const stepStates = deriveStepStates(status, progress);

  if (status === 'FAILED') {
    return (
      <div className="space-y-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertTitle>Analysis failed</AlertTitle>
          <AlertDescription>
            {job?.errorMessage ?? "Something went wrong while analyzing this site. It may be unreachable or blocking bots."}
          </AlertDescription>
        </Alert>
        <Button asChild>
          <Link href="/">Try another URL</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
          <span>{status === 'COMPLETED' ? 'Done' : 'Working'}</span>
          <span aria-hidden>{Math.round(progress)}%</span>
        </div>
        <Progress
          value={progress}
          aria-label="Analysis progress"
          aria-valuetext={`${Math.round(progress)} percent`}
        />
      </div>

      <ol
        aria-live="polite"
        aria-atomic="false"
        className="space-y-3"
      >
        {STEPS.map((step, i) => {
          const state = stepStates[i] ?? 'pending';
          return (
            <li key={step.id} className="flex items-center gap-3 text-base">
              {state === 'done' ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden />
              ) : state === 'active' ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden />
              ) : (
                <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" aria-hidden />
              )}
              <span
                className={
                  state === 'pending'
                    ? 'text-muted-foreground'
                    : state === 'active'
                      ? 'font-medium text-foreground'
                      : 'text-foreground'
                }
              >
                {step.label}
              </span>
              <span className="sr-only">
                {state === 'done' ? 'completed' : state === 'active' ? 'in progress' : 'pending'}
              </span>
            </li>
          );
        })}
      </ol>

      {stalled ? (
        <Alert variant="warning">
          <Clock className="h-4 w-4" aria-hidden />
          <AlertTitle>This is taking longer than expected</AlertTitle>
          <AlertDescription>
            The worker hasn&rsquo;t reported progress in the last minute. Hold on a bit, or
            <Link href="/" className="ml-1 underline underline-offset-2">try another URL</Link>.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertTitle>We had trouble checking status</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
