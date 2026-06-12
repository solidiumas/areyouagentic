export const siteConfig = {
  name: 'Are you agentic?',
  shortName: 'areyouagentic',
  tagline: 'Test how well your website works with AI agents.',
  description:
    'Free analysis of how AI agents and LLMs experience your website. Get a graded report on machine readability, structured data, agent signals, actionability, performance, and content clarity — with copy-paste fixes.',
  url: process.env.NEXT_PUBLIC_APP_URL ?? 'https://areyouagentic.com',
  ogImage: '/opengraph-image.png',
  twitter: '@areyouagentic',
  /** Release stage. Drives the beta badge in the header. */
  stage: 'beta' as 'beta' | 'stable',
  links: {
    github: 'https://github.com/solidiumas/areyouagentic',
    security: 'https://github.com/solidiumas/areyouagentic/blob/main/SECURITY.md',
    feedback: 'mailto:hello@areyouagentic.com?subject=areyouagentic.com%20beta%20feedback',
  },
} as const;

export type SiteConfig = typeof siteConfig;
