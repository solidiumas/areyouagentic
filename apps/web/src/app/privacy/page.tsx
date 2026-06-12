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
          When you submit a URL for analysis we store the URL, a normalized version, and the report
          we produce.
        </p>
        <p>
          Reports are <strong>public but unlisted</strong>: they are not indexed by search engines,
          but anyone who has the report link can open it. Treat a report link like a shareable
          secret. Do not submit private links, internal systems, pages behind authentication, or
          URLs containing tokens — we strip obvious tracking parameters, but you should not rely on
          a URL staying private.
        </p>

        <h2 className="mt-8 text-2xl font-semibold">Retention</h2>
        <p>
          Reports and the associated job records are automatically deleted <strong>90 days</strong>{' '}
          after they are created. Backups are retained no longer than 30 additional days.
        </p>

        <h2 className="mt-8 text-2xl font-semibold">Logs</h2>
        <p>
          Our API logs request metadata (IP, timestamp, path, status, request id) for abuse
          prevention and rate-limiting. Request bodies, cookies, and authorization headers are
          redacted before logging. Logs are retained for 30 days and never sold or shared.
        </p>

        <h2 className="mt-8 text-2xl font-semibold">Cookies</h2>
        <p>
          We set a single preference cookie for the dark-mode toggle. We do not use third-party
          analytics or advertising cookies on this site.
        </p>

        <h2 className="mt-8 text-2xl font-semibold">Third parties</h2>
        <p>
          To generate the written recommendations, our pipeline sends a{' '}
          <strong>structured summary of the analysis</strong> to Anthropic&rsquo;s Claude API: the
          per-dimension scores, the titles of the top findings, the page title, and the final URL.
          We do <strong>not</strong> send the raw page text, request metadata, cookies, or
          authorization headers. This step is skipped entirely when no AI key is configured.
        </p>

        <h2 className="mt-8 text-2xl font-semibold">Data deletion</h2>
        <p>
          You can delete a report yourself using the <strong>Delete report</strong> control shown on
          the report page right after analysis — keep the delete link it gives you, as it is shown
          only once. Otherwise reports are removed automatically after 90 days. For anything else,
          contact us via{' '}
          <a href={siteConfig.links.github} rel="noopener noreferrer" target="_blank">
            GitHub
          </a>
          .
        </p>
        <p>
          To report a security vulnerability, see{' '}
          <a href={siteConfig.links.security} rel="noopener noreferrer" target="_blank">
            SECURITY.md
          </a>
          .
        </p>
      </section>
    </article>
  );
}
