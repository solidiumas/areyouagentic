import type { Metadata } from 'next';

import { siteConfig } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Terms',
  description: `Terms of use for ${siteConfig.name}.`,
  alternates: { canonical: `${siteConfig.url}/terms` },
};

export default function TermsPage() {
  return (
    <article className="container max-w-3xl py-12 sm:py-16">
      <h1 className="text-4xl font-bold tracking-tight">Terms</h1>

      <section className="prose prose-slate mt-8 max-w-none dark:prose-invert">
        <p className="text-lg text-muted-foreground">
          By using {siteConfig.name} you agree to these terms. They&rsquo;re short on purpose.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">
          Use the service for sites you own or are authorized to test
        </h2>
        <p>
          Don&rsquo;t use this service to attack, probe, or exfiltrate from sites you don&rsquo;t
          have permission to analyze. Submitting URLs constitutes a representation that you are
          authorized to do so.
        </p>

        <h2 className="mt-8 text-2xl font-semibold">No warranty</h2>
        <p>
          The service is provided &ldquo;as is.&rdquo; Scores are advisory; treat them as a starting
          point, not a verdict. We make no guarantees about availability or accuracy.
        </p>

        <h2 className="mt-8 text-2xl font-semibold">Rate limits</h2>
        <p>
          We rate-limit per-IP to keep the service free and reliable. If you need higher limits for
          legitimate use, reach out via <a href={siteConfig.links.github}>GitHub</a>.
        </p>

        <h2 className="mt-8 text-2xl font-semibold">Changes</h2>
        <p>
          We may update these terms as the service evolves. Material changes will be highlighted in
          the changelog.
        </p>
      </section>
    </article>
  );
}
