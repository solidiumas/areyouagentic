/**
 * Ad-hoc local demo. Enqueues one analysis job, starts the worker, waits for
 * the job to finish, prints the report, then exits.
 *
 * Usage: pnpm --filter @areyouagentic/worker exec tsx src/scripts/demo.ts <url>
 */
import { JobStatus, prisma } from '@areyouagentic/db';
import { Queue } from 'bullmq';
import {
  ANALYSIS_QUEUE_NAME,
  type AnalysisJobPayload,
  createRedisConnection,
} from '../lib/queue.js';
import { createAnalysisWorker } from '../worker.js';

const url = process.argv[2] ?? 'https://example.com';

async function main(): Promise<void> {
  const queue = new Queue<AnalysisJobPayload>(ANALYSIS_QUEUE_NAME, {
    connection: createRedisConnection(),
  });
  const handle = createAnalysisWorker();
  await handle.worker.waitUntilReady();

  const dbJob = await prisma.analysisJob.create({
    data: { url, normalizedUrl: url, status: JobStatus.PENDING },
  });

  await queue.add(
    'analyze',
    { jobId: dbJob.id, url, normalizedUrl: url },
    { jobId: dbJob.id, attempts: 1 },
  );

  process.stdout.write(`Analyzing ${url} (job=${dbJob.id}) ...`);

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const row = await prisma.analysisJob.findUnique({
      where: { id: dbJob.id },
      select: { status: true, errorMessage: true },
    });
    if (row && (row.status === JobStatus.COMPLETED || row.status === JobStatus.FAILED)) {
      process.stdout.write(` ${row.status}\n`);
      if (row.errorMessage) console.error('error:', row.errorMessage);
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const report = await prisma.report.findUnique({
    where: { jobId: dbJob.id },
    select: {
      overallScore: true,
      grade: true,
      machineReadabilityScore: true,
      structuredDataScore: true,
      agentSignalsScore: true,
      actionabilityScore: true,
      performanceScore: true,
      contentClarityScore: true,
      findings: true,
      pageTitle: true,
      finalUrl: true,
    },
  });

  if (!report) {
    console.error('No report row written.');
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const findings = report.findings as any[];
    console.log('\n=== Report ===');
    console.log(`URL:    ${report.finalUrl}`);
    console.log(`Title:  ${report.pageTitle ?? '(none)'}`);
    console.log(`Score:  ${report.overallScore} / 100 (grade ${report.grade})`);
    console.log(`  machineReadability: ${report.machineReadabilityScore}`);
    console.log(`  structuredData:     ${report.structuredDataScore}`);
    console.log(`  agentSignals:       ${report.agentSignalsScore}`);
    console.log(`  actionability:      ${report.actionabilityScore}`);
    console.log(`  performance:        ${report.performanceScore}`);
    console.log(`  contentClarity:     ${report.contentClarityScore}`);
    console.log(`Findings: ${findings.length}`);
    for (const f of findings.slice(0, 10)) {
      console.log(`  [${f.severity}] ${f.title}`);
    }
    if (findings.length > 10) console.log(`  ... and ${findings.length - 10} more`);
  }

  await handle.worker.close();
  handle.connection.disconnect();
  const queueConn = await queue.client;
  await queue.close();
  queueConn.disconnect();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
