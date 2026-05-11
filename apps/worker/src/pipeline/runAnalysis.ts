import type { Job } from 'bullmq';
import { JobStatus, prisma } from '@areyouagentic/db';
import { logger } from '../lib/logger.js';
import { setProgress } from '../lib/jobProgress.js';
import type { AnalysisJobPayload } from '../lib/queue.js';
import type { AnalysisContext, Stage } from './context.js';
import { PermanentJobError } from './context.js';
import { fetchStage } from './stages/fetch.js';
import { renderStage } from './stages/render.js';
import { analyzeStage } from './stages/analyze.js';
import { scoreStage } from './stages/score.js';
import { persistStage } from './stages/persist.js';

/**
 * Run a single named stage with start/end logs and a duration in ms. Errors
 * propagate so the orchestrator can mark the job FAILED — we don't want a
 * stage-level catch to silently turn a hard failure into a half-baked report.
 */
async function runStage(name: string, stage: Stage, ctx: AnalysisContext): Promise<AnalysisContext> {
  const start = Date.now();
  ctx.log.info({ stage: name }, 'stage start');
  try {
    const next = await stage(ctx);
    ctx.log.info({ stage: name, durationMs: Date.now() - start }, 'stage done');
    return next;
  } catch (err) {
    ctx.log.error({ stage: name, durationMs: Date.now() - start, err }, 'stage failed');
    throw err;
  }
}

/**
 * Top-level pipeline. Called once per BullMQ job. Owns the AnalysisJob row
 * lifecycle (PENDING → RUNNING → COMPLETED/FAILED) and translates progress
 * checkpoints into BullMQ's progress field.
 *
 * Stage ordering:
 *   - fetch and render are independent (render goes to the URL itself, it
 *     doesn't need rawHtml) → run in parallel
 *   - analyze depends on both → sequential after the parallel pair
 *   - score depends on analyze findings → sequential
 *   - persist writes the resulting Report → sequential, last
 */
export async function runAnalysis(job: Job<AnalysisJobPayload>): Promise<void> {
  const { jobId, url, requestId } = job.data;
  // requestId carries through from the originating HTTP request — log it so
  // worker entries can be joined with API entries for the same flow.
  const log = logger.child({ jobId, url, bullJobId: job.id, requestId });

  await prisma.analysisJob.update({
    where: { id: jobId },
    data: { status: JobStatus.RUNNING, startedAt: new Date() },
  });
  await setProgress(job, 'queued');

  let ctx: AnalysisContext = { url, jobId, findings: {}, log };

  try {
    await setProgress(job, 'fetch');
    const [fetched, rendered] = await Promise.all([
      runStage('fetch', fetchStage, ctx),
      runStage('render', renderStage, ctx),
    ]);
    ctx = { ...ctx, ...fetched, ...rendered };

    await setProgress(job, 'render');

    await setProgress(job, 'analyze');
    ctx = await runStage('analyze', analyzeStage, ctx);

    await setProgress(job, 'score');
    ctx = await runStage('score', scoreStage, ctx);

    await setProgress(job, 'persist');
    ctx = await runStage('persist', persistStage, ctx);

    await setProgress(job, 'done');

    await prisma.analysisJob.update({
      where: { id: jobId },
      data: { status: JobStatus.COMPLETED, completedAt: new Date() },
    });
    log.info('analysis complete');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permanent = err instanceof PermanentJobError;
    log.error({ err, permanent }, 'analysis failed');

    await prisma.analysisJob.update({
      where: { id: jobId },
      data: {
        status: JobStatus.FAILED,
        errorMessage: message.slice(0, 1000),
        completedAt: new Date(),
      },
    });

    // Re-throw so BullMQ records the failure. Permanent errors bypass retries
    // via the worker's failure handler (see worker.ts).
    throw err;
  }
}
