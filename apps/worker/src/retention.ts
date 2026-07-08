/**
 * Data-retention job. Deletes AnalysisJob rows older than RETENTION_DAYS,
 * which cascades to the associated Report rows (FK ON DELETE CASCADE), and
 * deletes the R2 screenshot objects those reports reference — otherwise the
 * bucket (public!) would keep every screenshot forever.
 *
 * Designed to be invoked on a daily cron from the deployment platform:
 *   node dist/retention.js
 *
 * Idempotent and safe to re-run. Deletes are batched so a one-off cleanup of
 * a long-uncleaned database doesn't lock the table.
 */
import { prisma } from '@areyouagentic/db';
import { extractScreenshotKeys } from '@areyouagentic/shared';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { deleteScreenshots } from './lib/r2.js';

// Via the Zod-validated env (fail-fast on garbage), like every other knob.
const RETENTION_DAYS = env.RETENTION_DAYS;
const BATCH_SIZE = env.RETENTION_BATCH_SIZE;

export async function deleteExpiredJobs(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  let totalDeleted = 0;
  // Batched loop — pulls a page of stale ids then deletes them in one statement.
  // Stops when a batch returns fewer than BATCH_SIZE rows.
  while (true) {
    const batch = await prisma.analysisJob.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;

    const batchIds = batch.map((j: { id: string }) => j.id);

    // Delete the R2 screenshots referenced by this batch's reports BEFORE the
    // rows — after the cascade there is no record left of which objects to
    // remove. Best-effort: rows are still deleted on R2 failure (the 90-day
    // retention promise wins), but the orphaned keys are logged loudly so
    // they can be cleaned up by hand.
    const reports = await prisma.report.findMany({
      where: { jobId: { in: batchIds } },
      select: { evidence: true },
    });
    const screenshotKeys = reports.flatMap((r: { evidence: unknown }) =>
      extractScreenshotKeys(r.evidence),
    );
    if (screenshotKeys.length > 0) {
      try {
        await deleteScreenshots(screenshotKeys);
        logger.info({ deleted: screenshotKeys.length }, 'retention: deleted R2 screenshots');
      } catch (err) {
        logger.error(
          { err, orphanedKeys: screenshotKeys },
          'retention: R2 screenshot delete failed — objects orphaned, clean up manually',
        );
      }
    }

    const result = await prisma.analysisJob.deleteMany({
      where: { id: { in: batchIds } },
    });
    totalDeleted += result.count;

    logger.info(
      { deleted: result.count, cumulative: totalDeleted, cutoff: cutoff.toISOString() },
      'retention: deleted batch',
    );

    if (batch.length < BATCH_SIZE) break;
  }

  return totalDeleted;
}

async function main(): Promise<void> {
  const started = Date.now();
  logger.info({ retentionDays: RETENTION_DAYS }, 'retention: starting');

  try {
    const deleted = await deleteExpiredJobs();
    logger.info({ deleted, durationMs: Date.now() - started }, 'retention: complete');
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when invoked as a script — not when imported by tests.
const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith('retention.js');

if (isMain) {
  main().catch((err) => {
    logger.fatal({ err }, 'retention: failed');
    process.exit(1);
  });
}
