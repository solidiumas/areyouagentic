/**
 * Data-retention job. Deletes AnalysisJob rows older than RETENTION_DAYS,
 * which cascades to the associated Report rows (FK ON DELETE CASCADE).
 *
 * Designed to be invoked on a daily cron from the deployment platform:
 *   node dist/retention.js
 *
 * Idempotent and safe to re-run. Deletes are batched so a one-off cleanup of
 * a long-uncleaned database doesn't lock the table.
 */
import { prisma } from '@areyouagentic/db';
import { logger } from './lib/logger.js';

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 90);
const BATCH_SIZE = Number(process.env.RETENTION_BATCH_SIZE ?? 500);

export async function deleteExpiredJobs(now: Date = new Date()): Promise<number> {
  if (!Number.isFinite(RETENTION_DAYS) || RETENTION_DAYS <= 0) {
    throw new Error(`Invalid RETENTION_DAYS: ${RETENTION_DAYS}`);
  }
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

    const result = await prisma.analysisJob.deleteMany({
      where: { id: { in: batch.map((j) => j.id) } },
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
    logger.info(
      { deleted, durationMs: Date.now() - started },
      'retention: complete',
    );
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
