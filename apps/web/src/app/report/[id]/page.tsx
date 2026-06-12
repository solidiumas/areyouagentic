import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { DeleteReportButton } from '@/components/delete-report-button';
import { ApiClientError, getReport } from '@/lib/api';
import {
  DIMENSIONS,
  type Dimension,
  type Finding,
  type Recommendation,
  type ReportData,
} from '@areyouagentic/shared';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Report ${id}`,
    description: 'Agentic readiness report — graded findings and copy-paste fixes.',
    robots: { index: false, follow: false },
  };
}

const DIMENSION_LABELS: Record<Dimension, string> = {
  machineReadability: 'Machine readability',
  structuredData: 'Structured data',
  agentSignals: 'Agent signals',
  actionability: 'Actionability',
  performance: 'Performance',
  contentClarity: 'Content clarity',
};

const SEVERITY_VARIANT: Record<
  Finding['severity'],
  'default' | 'secondary' | 'destructive' | 'success'
> = {
  high: 'destructive',
  medium: 'default',
  low: 'secondary',
  info: 'success',
};

function dimensionScore(report: ReportData, d: Dimension): number {
  switch (d) {
    case 'machineReadability':
      return report.machineReadabilityScore;
    case 'structuredData':
      return report.structuredDataScore;
    case 'agentSignals':
      return report.agentSignalsScore;
    case 'actionability':
      return report.actionabilityScore;
    case 'performance':
      return report.performanceScore;
    case 'contentClarity':
      return report.contentClarityScore;
  }
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let report: ReportData;
  try {
    report = await getReport(id);
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) notFound();
    throw err;
  }

  const recsByPriority: Record<Recommendation['priority'], Recommendation[]> = {
    high: [],
    medium: [],
    low: [],
  };
  for (const rec of report.recommendations) recsByPriority[rec.priority].push(rec);

  return (
    <div className="container max-w-5xl py-10 sm:py-14">
      <header className="flex flex-col gap-4 border-b border-border/60 pb-8">
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="break-all">{report.finalUrl}</span>
          <span aria-hidden>·</span>
          <time dateTime={report.createdAt.toISOString()}>{report.createdAt.toLocaleString()}</time>
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {report.pageTitle ?? 'Agentic readiness report'}
        </h1>
        <div className="flex items-end gap-6">
          <div
            className="text-7xl font-bold leading-none tracking-tight"
            aria-label={`Grade ${report.grade}`}
          >
            {report.grade}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Overall score</p>
            <p className="text-2xl font-semibold tabular-nums">{report.overallScore} / 100</p>
          </div>
        </div>
      </header>

      <section aria-labelledby="scores-heading" className="py-10">
        <h2 id="scores-heading" className="text-xl font-semibold tracking-tight">
          Scores by dimension
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {DIMENSIONS.map((d) => {
            const score = dimensionScore(report, d);
            return (
              <Card key={d}>
                <CardHeader className="space-y-1">
                  <CardTitle className="text-base">{DIMENSION_LABELS[d]}</CardTitle>
                  <CardDescription className="tabular-nums">{score} / 100</CardDescription>
                </CardHeader>
                <CardContent>
                  <Progress
                    value={score}
                    aria-label={`${DIMENSION_LABELS[d]} score`}
                    aria-valuetext={`${score} of 100`}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <Tabs defaultValue="recommendations" className="mt-6">
        <TabsList>
          <TabsTrigger value="recommendations">
            Recommendations ({report.recommendations.length})
          </TabsTrigger>
          <TabsTrigger value="findings">Findings ({report.findings.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="recommendations" className="space-y-8 pt-4">
          {(['high', 'medium', 'low'] as const).map((priority) => {
            const items = recsByPriority[priority];
            if (items.length === 0) return null;
            return (
              <section key={priority} aria-labelledby={`rec-${priority}`}>
                <h3 id={`rec-${priority}`} className="mb-3 text-lg font-semibold capitalize">
                  {priority} priority
                </h3>
                <div className="space-y-4">
                  {items.map((rec, i) => (
                    <Card key={`${priority}-${i}`}>
                      <CardHeader>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{DIMENSION_LABELS[rec.category]}</Badge>
                          <Badge
                            variant={
                              priority === 'high'
                                ? 'destructive'
                                : priority === 'medium'
                                  ? 'default'
                                  : 'secondary'
                            }
                          >
                            {priority}
                          </Badge>
                        </div>
                        <CardTitle className="mt-2 text-base">{rec.title}</CardTitle>
                        <CardDescription>{rec.description}</CardDescription>
                      </CardHeader>
                      {rec.exampleCode ? (
                        <CardContent>
                          <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs">
                            <code>{rec.exampleCode}</code>
                          </pre>
                        </CardContent>
                      ) : null}
                    </Card>
                  ))}
                </div>
              </section>
            );
          })}
        </TabsContent>

        <TabsContent value="findings" className="pt-4">
          <Accordion type="multiple" className="w-full">
            {report.findings.map((finding) => (
              <AccordionItem key={finding.id} value={finding.id}>
                <AccordionTrigger>
                  <div className="flex flex-1 items-center gap-3 pr-4 text-left">
                    <Badge variant={SEVERITY_VARIANT[finding.severity]}>{finding.severity}</Badge>
                    <span>{finding.title}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <p>{finding.description}</p>
                  {finding.evidence ? (
                    <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">
                      <code>{finding.evidence}</code>
                    </pre>
                  ) : null}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </TabsContent>
      </Tabs>

      <div className="mt-12">
        <Button asChild variant="secondary">
          <Link href="/">Analyze another site</Link>
        </Button>
      </div>

      <DeleteReportButton reportId={id} />
    </div>
  );
}
