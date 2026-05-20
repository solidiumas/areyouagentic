import type { Metadata } from 'next';
import { CheckCircle2, FileSearch, Sparkles } from 'lucide-react';

import { UrlForm } from '@/components/url-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { siteConfig } from '@/lib/site';

// Render server-side so AI agents and search crawlers see the full page.
export const dynamic = 'force-static';
export const revalidate = 3600;

export const metadata: Metadata = {
  title: `${siteConfig.name} — ${siteConfig.tagline}`,
  description: siteConfig.description,
  alternates: { canonical: siteConfig.url },
};

const FAQ_ITEMS = [
  {
    q: 'What is an "agentic" website?',
    a: 'An agentic website is one that AI agents — like ChatGPT, Claude, or autonomous browsers — can read, understand, and act on without a human in the loop. It exposes structured data, supports llms.txt and robots.txt for agents, renders meaningful HTML without heavy client-side JavaScript, and offers clear actions agents can complete.',
  },
  {
    q: 'How do you score a site?',
    a: 'We score six dimensions: machine readability, structured data, agent signals, actionability, performance, and content clarity. Each dimension produces findings with severity and copy-paste fixes. The overall grade (A–F) is a weighted average.',
  },
  {
    q: 'Will this slow down my site or modify it?',
    a: 'No. We fetch and render your page once, like any well-behaved bot. We only read public content and never submit forms or click destructive buttons.',
  },
  {
    q: 'Why does this matter?',
    a: 'AI agents are quickly becoming a primary way people browse the web. Sites that agents can read get cited, summarised, and acted on. Sites they cannot read effectively become invisible to a growing slice of traffic.',
  },
];

const faqLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ_ITEMS.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: {
      '@type': 'Answer',
      text: item.a,
    },
  })),
};

export default function HomePage() {
  return (
    <>
      <section
        aria-labelledby="hero-heading"
        className="relative overflow-hidden border-b border-border/60"
      >
        <div className="container py-16 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <Badge variant="secondary" className="mb-6">
              <Sparkles className="mr-1.5 h-3 w-3" aria-hidden />
              Free analysis · No signup
            </Badge>
            <h1
              id="hero-heading"
              className="text-balance text-4xl font-bold tracking-tight sm:text-6xl lg:text-7xl"
            >
              Are you agentic?
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-muted-foreground sm:text-xl">
              Test how well your website works with AI agents. Get a graded report and copy-paste
              fixes in under a minute.
            </p>

            <div className="mx-auto mt-8 max-w-2xl">
              <UrlForm />
            </div>

            <p className="mt-8 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">Beta:</span> we&rsquo;d love your
              feedback —{' '}
              <a href={siteConfig.links.feedback} className="underline hover:text-foreground">
                send a note
              </a>
              .
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="info-heading" className="container py-16 sm:py-24">
        <h2 id="info-heading" className="sr-only">
          What this is
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <FileSearch className="h-6 w-6 text-primary" aria-hidden />
              <CardTitle>What we check</CardTitle>
              <CardDescription>
                Six dimensions, dozens of checks — built around how real AI agents fetch and read
                your pages.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• Machine readability &amp; rendered content</li>
                <li>• Structured data (JSON-LD, microdata)</li>
                <li>• Agent signals (robots.txt, llms.txt, sitemaps)</li>
                <li>• Actionability of buttons and forms</li>
                <li>• Performance &amp; response budgets</li>
                <li>• Content clarity &amp; semantics</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Sparkles className="h-6 w-6 text-primary" aria-hidden />
              <CardTitle>Why it matters</CardTitle>
              <CardDescription>
                AI agents are becoming a primary entry point. If they cannot read your site, they
                cannot recommend it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Tomorrow&rsquo;s users arrive through agents that summarise, compare, and book on
                their behalf. The same patterns that help agents — semantic HTML, structured data,
                fast responses — also help search and screen readers.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CheckCircle2 className="h-6 w-6 text-primary" aria-hidden />
              <CardTitle>How to use the report</CardTitle>
              <CardDescription>
                Each finding comes with a severity, a plain-English explanation, and a copy-paste
                fix.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm text-muted-foreground">
                <li>1. Read the overall grade and per-dimension scores.</li>
                <li>2. Start with high-severity findings — they unlock the most points.</li>
                <li>3. Apply the suggested snippets and re-run the analysis.</li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="faq-heading" className="border-t border-border/60 bg-muted/30">
        <div className="container py-16 sm:py-24">
          <h2 id="faq-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
            Frequently asked questions
          </h2>
          <dl className="mt-8 grid gap-6 sm:grid-cols-2">
            {FAQ_ITEMS.map((item) => (
              <div key={item.q}>
                <dt className="font-medium text-foreground">{item.q}</dt>
                <dd className="mt-1 text-sm text-muted-foreground">{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />
    </>
  );
}
