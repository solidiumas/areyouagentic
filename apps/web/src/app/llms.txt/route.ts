import { siteConfig } from '@/lib/site';

export const dynamic = 'force-static';

const BODY = `# ${siteConfig.name}

> ${siteConfig.tagline}

${siteConfig.description}

## What this site does

areyouagentic.com analyzes a public webpage and produces a graded report on
how readable and actionable it is for AI agents and LLMs. The grade combines
six dimensions: machine readability, structured data, agent signals,
actionability, performance, and content clarity.

## Primary endpoints (HTML)

- ${siteConfig.url}/ — landing page; the main agent-friendly entry point.
- ${siteConfig.url}/about — what we measure and why.
- ${siteConfig.url}/privacy — privacy policy.
- ${siteConfig.url}/terms — terms of use.

## API (JSON)

- POST ${siteConfig.url}/api/analyze — body: { "url": "https://example.com" }; returns { "jobId": "..." }.
- GET  ${siteConfig.url}/api/jobs/{id} — returns { "id", "status", "progress", "reportId", "errorMessage" }.
- GET  ${siteConfig.url}/api/reports/{id} — returns the full graded report.

## Crawling guidance

- Our own bot identifies as "AreYouAgenticBot/1.0" and respects robots.txt.
- /analyzing/* and /report/* are user-specific; please don't index them.
- The sitemap lives at ${siteConfig.url}/sitemap.xml.

## Contact

GitHub: ${siteConfig.links.github}
`;

export function GET(): Response {
  return new Response(BODY, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
