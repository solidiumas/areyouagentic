import { JobStatus, prisma } from '@areyouagentic/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteExpiredJobs } from './retention.js';

const DAY = 24 * 60 * 60 * 1000;
const SAMPLE_URL = 'https://example.com/retention-test';

describe('retention — deleteExpiredJobs', () => {
  beforeEach(async () => {
    await prisma.report.deleteMany();
    await prisma.analysisJob.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('deletes jobs older than the cutoff and leaves recent ones', async () => {
    const now = new Date();

    const oldJob = await prisma.analysisJob.create({
      data: {
        url: SAMPLE_URL,
        normalizedUrl: SAMPLE_URL,
        status: JobStatus.COMPLETED,
        // 100 days old — well past the 90-day default
        createdAt: new Date(now.getTime() - 100 * DAY),
      },
    });

    const recentJob = await prisma.analysisJob.create({
      data: {
        url: SAMPLE_URL,
        normalizedUrl: SAMPLE_URL + '2',
        status: JobStatus.COMPLETED,
        createdAt: new Date(now.getTime() - 7 * DAY),
      },
    });

    const deleted = await deleteExpiredJobs(now);
    expect(deleted).toBe(1);

    expect(await prisma.analysisJob.findUnique({ where: { id: oldJob.id } })).toBeNull();
    expect(await prisma.analysisJob.findUnique({ where: { id: recentJob.id } })).not.toBeNull();
  });

  it('cascades to the associated Report', async () => {
    const now = new Date();
    const oldJob = await prisma.analysisJob.create({
      data: {
        url: SAMPLE_URL,
        normalizedUrl: SAMPLE_URL + '3',
        status: JobStatus.COMPLETED,
        createdAt: new Date(now.getTime() - 95 * DAY),
        report: {
          create: {
            overallScore: 50,
            grade: 'C',
            machineReadabilityScore: 50,
            structuredDataScore: 50,
            agentSignalsScore: 50,
            actionabilityScore: 50,
            performanceScore: 50,
            contentClarityScore: 50,
            findings: [],
            recommendations: [],
            evidence: [],
            finalUrl: SAMPLE_URL,
          },
        },
      },
      include: { report: true },
    });

    await deleteExpiredJobs(now);

    expect(await prisma.report.findUnique({ where: { id: oldJob.report!.id } })).toBeNull();
  });

  it('returns 0 when no jobs are old enough', async () => {
    const now = new Date();
    await prisma.analysisJob.create({
      data: {
        url: SAMPLE_URL,
        normalizedUrl: SAMPLE_URL + '4',
        status: JobStatus.COMPLETED,
        createdAt: new Date(now.getTime() - 30 * DAY),
      },
    });

    expect(await deleteExpiredJobs(now)).toBe(0);
  });
});
