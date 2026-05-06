import type { Metadata } from 'next';

import { siteConfig } from '@/lib/site';

export const metadata: Metadata = {
  title: 'About',
  description: `About ${siteConfig.name} — what we measure, why it matters, and who builds it.`,
  alternates: { canonical: `${siteConfig.url}/about` },
};

export default function AboutPage() {
  return (
    <article className="container max-w-3xl py-12 sm:py-16">
      <h1 className="text-4xl font-bold tracking-tight">About {siteConfig.name}</h1>

      <section className="prose prose-slate mt-8 max-w-none dark:prose-invert">
        <p className="text-lg text-muted-foreground">
          AI agents are quickly becoming a primary way people browse the web. They search,
          summarize, compare, and increasingly act on behalf of their users. {siteConfig.name}{' '}
          measures how well a website meets agents on their terms.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">What we measure</h2>
        <p>
          We grade six dimensions an agent cares about: machine readability, structured data,
          agent signals, actionability, performance, and content clarity. Each dimension is
          backed by deterministic checks (HTML parsing, header inspection, structured data
          validation) and synthesized into a per-page score.
        </p>

        <h2 className="mt-8 text-2xl font-semibold">Why a separate score from SEO</h2>
        <p>
          Search engines and AI agents overlap, but they aren&rsquo;t the same. Agents care more
          about clean rendered HTML, semantic structure, and explicit affordances (forms,
          buttons, structured actions). A site that ranks well on Google can still be opaque to a
          coding agent or research assistant.
        </p>

        <h2 className="mt-8 text-2xl font-semibold">How we behave</h2>
        <ul>
          <li>We identify ourselves with a clear User-Agent and a contact URL.</li>
          <li>We respect robots.txt for our own crawler.</li>
          <li>We never submit forms, click destructive buttons, or follow tracking links.</li>
          <li>We rate-limit ourselves so we don&rsquo;t hammer your origin.</li>
        </ul>

        <h2 className="mt-8 text-2xl font-semibold">Open questions, open feedback</h2>
        <p>
          The criteria are evolving as the agentic web evolves. Open an issue on{' '}
          <a href={siteConfig.links.github}>GitHub</a> with feedback, edge cases, or ideas for
          new checks.
        </p>
      </section>
    </article>
  );
}
