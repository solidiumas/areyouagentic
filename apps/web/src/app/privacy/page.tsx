import type { Metadata } from 'next';

import { siteConfig } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Privacy',
  description: `Privacy policy for ${siteConfig.name}.`,
  alternates: { canonical: `${siteConfig.url}/privacy` },
};

export default function PrivacyPage() {
  return (
    <article className="container max-w-3xl py-12 sm:py-16">
      <h1 className="text-4xl font-bold tracking-tight">Privacy</h1>

      <section className="prose prose-slate mt-8 max-w-none dark:prose-invert">
        <p className="text-lg text-muted-foreground">
          We try to collect as little as possible while still running a useful service. This page
          summarizes what we do and don&rsquo;t collect.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">URLs you submit</h2>
        <p>
          When you submit a URL for analysis we store the URL, a normalized version, and the
          report we produce. Reports are public by id but not indexed.
        </p>

        <h2 className="mt-8 text-2xl font-semibold">Logs</h2>
        <p>
          Our API logs request metadata (IP, timestamp, status) for abuse prevention and
          rate-limiting. Logs are retained for a short window and never sold or shared.
        </p>

        <h2 className="mt-8 text-2xl font-semibold">Cookies</h2>
        <p>
          We set a single preference cookie for the dark-mode toggle. We do not use third-party
          analytics or advertising cookies on this site.
        </p>

        <h2 className="mt-8 text-2xl font-semibold">Data deletion</h2>
        <p>
          To request deletion of a report or any associated data, contact us via{' '}
          <a href={siteConfig.links.github}>GitHub</a>.
        </p>
      </section>
    </article>
  );
}
