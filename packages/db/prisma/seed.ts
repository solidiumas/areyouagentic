/**
 * Seed: 3 example analyses showing the high / medium / low end of the
 * score range. Every JSON payload is validated against its Zod schema before
 * insert so seed data drifting from `@areyouagentic/shared` fails loudly
 * instead of silently writing garbage to JSONB.
 */
import {
  type Evidence,
  type Findings,
  type Recommendations,
  evidenceSchema,
  findingsSchema,
  recommendationsSchema,
} from '@areyouagentic/shared';
import { JobStatus, type Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normalize(url: string): string {
  const u = new URL(url);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  return u.toString();
}

const now = new Date();
const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);

// ── Example 1: well-prepared site (Grade B, 85) ─────────────────────
const goodFindings: Findings = findingsSchema.parse([
  {
    id: 'robots-allows-agents',
    severity: 'info',
    title: 'robots.txt allows AI agents',
    description: 'No disallow rules target known agent user-agents.',
  },
  {
    id: 'ssr-content-present',
    severity: 'info',
    title: 'Primary content is server-rendered',
    description: 'Main copy is present in the initial HTML response.',
  },
  {
    id: 'jsonld-organization',
    severity: 'info',
    title: 'Organization schema present',
    description: 'Schema.org Organization JSON-LD found in <head>.',
  },
  {
    id: 'llms-txt-present',
    severity: 'info',
    title: 'llms.txt available',
    description: '/llms.txt was served with a usable index.',
  },
  {
    id: 'ttfb-fast',
    severity: 'info',
    title: 'TTFB under 300 ms',
    description: 'Time to first byte was 210 ms from a cold cache.',
  },
  {
    id: 'heading-structure',
    severity: 'low',
    title: 'Multiple H1 elements',
    description: 'Two H1s detected; agents prefer a single page-level H1.',
    recommendation: {
      priority: 'low',
      category: 'contentClarity',
      title: 'Use exactly one H1 per page',
      description: 'Demote the secondary H1 to H2 so agents have an unambiguous page title.',
      exampleCode: '<h2>Section title</h2>',
    },
  },
]);

const goodRecommendations: Recommendations = recommendationsSchema.parse([
  {
    priority: 'low',
    category: 'contentClarity',
    title: 'Use exactly one H1 per page',
    description: 'Demote the secondary H1 to H2 so agents have an unambiguous page title.',
    exampleCode: '<h2>Section title</h2>',
  },
]);

const goodEvidence: Evidence = evidenceSchema.parse([
  {
    id: 'ev-robots',
    type: 'robots-txt',
    inline: 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml',
    contentType: 'text/plain',
    capturedAt: minutesAgo(15).toISOString(),
  },
  {
    id: 'ev-html',
    type: 'html-snapshot',
    url: 'https://artifacts.example.com/seed/example-com.html',
    contentType: 'text/html',
    capturedAt: minutesAgo(15).toISOString(),
  },
  {
    id: 'ev-jsonld',
    type: 'json-ld',
    inline: '{"@context":"https://schema.org","@type":"Organization","name":"Example Inc"}',
    contentType: 'application/ld+json',
    capturedAt: minutesAgo(15).toISOString(),
  },
]);

// ── Example 2: typical SPA (Grade C, 62) ────────────────────────────
const okFindings: Findings = findingsSchema.parse([
  {
    id: 'spa-hydration-required',
    severity: 'high',
    title: 'Content requires JavaScript hydration',
    description:
      'Initial HTML is a near-empty shell; content appears only after client-side hydration.',
  },
  {
    id: 'jsonld-partial',
    severity: 'medium',
    title: 'Partial structured data',
    description: 'Product schema present but missing offers/reviews.',
  },
  {
    id: 'no-llms-txt',
    severity: 'medium',
    title: 'No llms.txt',
    description: '/llms.txt returned 404.',
  },
  {
    id: 'forms-labeled',
    severity: 'info',
    title: 'Forms have accessible labels',
    description: 'All form inputs have associated <label> elements.',
  },
]);

const okRecommendations: Recommendations = recommendationsSchema.parse([
  {
    priority: 'high',
    category: 'machineReadability',
    title: 'Prerender or SSR critical content',
    description:
      'Serve the main content in the initial HTML so agents without a JS runtime can read it.',
  },
  {
    priority: 'medium',
    category: 'agentSignals',
    title: 'Publish an llms.txt index',
    description: 'Provide /llms.txt pointing to your most important content for AI agents.',
    exampleCode: '# Acme Docs\n- [Pricing](https://acme.example/pricing)\n',
  },
]);

const okEvidence: Evidence = evidenceSchema.parse([
  {
    id: 'ev-spa-html',
    type: 'html-snapshot',
    url: 'https://artifacts.example.com/seed/spa-shell.html',
    contentType: 'text/html',
    capturedAt: minutesAgo(45).toISOString(),
    description: 'Initial response — note empty <main>',
  },
]);

// ── Example 3: hostile-to-agents (Grade F, 32) ──────────────────────
const badFindings: Findings = findingsSchema.parse([
  {
    id: 'robots-blocks-agents',
    severity: 'high',
    title: 'robots.txt blocks AI user-agents',
    description: 'GPTBot, ClaudeBot, and PerplexityBot are explicitly disallowed.',
    evidence: 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /',
  },
  {
    id: 'spa-no-ssr',
    severity: 'high',
    title: 'No server-rendered content',
    description: 'Pure client-side React app; initial HTML is a noscript shell.',
  },
  {
    id: 'no-structured-data',
    severity: 'high',
    title: 'No structured data',
    description: 'No JSON-LD, Microdata, or RDFa detected.',
  },
  {
    id: 'unlabeled-buttons',
    severity: 'medium',
    title: 'Icon-only buttons without aria-label',
    description: '6 of 9 interactive controls have no accessible name.',
  },
  {
    id: 'slow-ttfb',
    severity: 'medium',
    title: 'Slow TTFB (1.8s)',
    description: 'Time to first byte exceeds the 1s threshold.',
  },
]);

const badRecommendations: Recommendations = recommendationsSchema.parse([
  {
    priority: 'high',
    category: 'agentSignals',
    title: 'Allow AI agents in robots.txt',
    description:
      'Remove the explicit disallows for GPTBot/ClaudeBot/PerplexityBot, or scope them to private paths only.',
    exampleCode: 'User-agent: ClaudeBot\nAllow: /\n',
  },
  {
    priority: 'high',
    category: 'structuredData',
    title: 'Add Schema.org JSON-LD',
    description: 'At minimum, add Organization and WebSite schemas to the homepage.',
  },
  {
    priority: 'medium',
    category: 'actionability',
    title: 'Add aria-label to icon buttons',
    description: 'Icon-only buttons need an accessible name so agents can describe the action.',
    exampleCode: '<button aria-label="Add to cart">…</button>',
  },
]);

const badEvidence: Evidence = evidenceSchema.parse([
  {
    id: 'ev-bad-robots',
    type: 'robots-txt',
    inline: 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n',
    contentType: 'text/plain',
    capturedAt: minutesAgo(120).toISOString(),
  },
]);

async function main() {
  // Wipe in dependency order. `onDelete: Cascade` covers Reports too, but
  // being explicit makes the intent obvious.
  await prisma.report.deleteMany();
  await prisma.analysisJob.deleteMany();

  const examples = [
    {
      url: 'https://example.com/',
      pageTitle: 'Example Inc — Modern Tools for Builders',
      overallScore: 85,
      grade: 'B',
      scores: {
        machineReadability: 90,
        structuredData: 85,
        agentSignals: 80,
        actionability: 90,
        performance: 88,
        contentClarity: 78,
      },
      findings: goodFindings,
      recommendations: goodRecommendations,
      evidence: goodEvidence,
      startedOffsetMin: 16,
      completedOffsetMin: 14,
    },
    {
      url: 'https://shop.example.org/products/widget',
      pageTitle: 'Widget — Acme Shop',
      overallScore: 62,
      grade: 'C',
      scores: {
        machineReadability: 50,
        structuredData: 65,
        agentSignals: 40,
        actionability: 70,
        performance: 70,
        contentClarity: 75,
      },
      findings: okFindings,
      recommendations: okRecommendations,
      evidence: okEvidence,
      startedOffsetMin: 46,
      completedOffsetMin: 43,
    },
    {
      url: 'https://legacy.example.net/',
      pageTitle: 'Legacy Co.',
      overallScore: 32,
      grade: 'F',
      scores: {
        machineReadability: 20,
        structuredData: 15,
        agentSignals: 10,
        actionability: 35,
        performance: 50,
        contentClarity: 60,
      },
      findings: badFindings,
      recommendations: badRecommendations,
      evidence: badEvidence,
      startedOffsetMin: 121,
      completedOffsetMin: 118,
    },
  ];

  for (const ex of examples) {
    await prisma.analysisJob.create({
      data: {
        url: ex.url,
        normalizedUrl: normalize(ex.url),
        status: JobStatus.COMPLETED,
        createdAt: minutesAgo(ex.startedOffsetMin + 1),
        startedAt: minutesAgo(ex.startedOffsetMin),
        completedAt: minutesAgo(ex.completedOffsetMin),
        report: {
          create: {
            overallScore: ex.overallScore,
            grade: ex.grade,
            machineReadabilityScore: ex.scores.machineReadability,
            structuredDataScore: ex.scores.structuredData,
            agentSignalsScore: ex.scores.agentSignals,
            actionabilityScore: ex.scores.actionability,
            performanceScore: ex.scores.performance,
            contentClarityScore: ex.scores.contentClarity,
            findings: ex.findings as unknown as Prisma.InputJsonValue,
            recommendations: ex.recommendations as unknown as Prisma.InputJsonValue,
            evidence: ex.evidence as unknown as Prisma.InputJsonValue,
            pageTitle: ex.pageTitle,
            finalUrl: ex.url,
            createdAt: minutesAgo(ex.completedOffsetMin),
          },
        },
      },
    });
  }

  console.warn(`Seeded ${examples.length} analyses.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
