import type { Metadata } from 'next';

import { AnalyzingChecklist } from '@/components/analyzing-checklist';

export const metadata: Metadata = {
  title: 'Analyzing your site…',
  description: 'Live progress while we analyze how AI agents experience your website.',
  robots: { index: false, follow: false },
};

export default async function AnalyzingPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;

  return (
    <div className="container max-w-2xl py-12 sm:py-16">
      <header className="mb-10">
        <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Job {jobId}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Analyzing your site
        </h1>
        <p className="mt-2 text-muted-foreground">
          We&rsquo;re fetching your page the same way an AI agent would, and grading what we
          find. This usually takes 30–60 seconds.
        </p>
      </header>
      <AnalyzingChecklist jobId={jobId} />
    </div>
  );
}
