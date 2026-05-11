import type { MetadataRoute } from 'next';

import { siteConfig } from '@/lib/site';

/**
 * robots.txt that explicitly welcomes well-known AI agent crawlers in addition
 * to the default *. Listing them by name removes ambiguity for operators that
 * read robots.txt strictly (and signals intent in case `*` rules diverge).
 */
const AGENT_BOTS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Bingbot',
  'CCBot',
  'cohere-ai',
  'Diffbot',
  'FacebookBot',
  'Applebot-Extended',
  'YouBot',
  'Amazonbot',
  'MistralAI-User',
  'Bytespider',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/analyzing/', '/report/'],
      },
      ...AGENT_BOTS.map((bot) => ({
        userAgent: bot,
        allow: '/',
        disallow: ['/analyzing/', '/report/'],
      })),
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}
