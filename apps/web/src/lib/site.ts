export const siteConfig = {
  name: 'Are you agentic?',
  shortName: 'areyouagentic',
  tagline: 'Test how well your website works with AI agents.',
  description:
    'Free analysis of how AI agents and LLMs experience your website. Get a graded report on machine readability, structured data, agent signals, actionability, performance, and content clarity — with copy-paste fixes.',
  url: process.env.NEXT_PUBLIC_APP_URL ?? 'https://areyouagentic.com',
  ogImage: '/opengraph-image.png',
  twitter: '@areyouagentic',
  links: {
    github: 'https://github.com/areyouagentic',
  },
} as const;

export type SiteConfig = typeof siteConfig;
