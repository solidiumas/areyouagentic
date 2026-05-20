import type { Finding } from '@areyouagentic/shared';
import type { Analyzer, AnalyzerResult } from './types.js';
import { clampScore, snippet } from './utils/dom.js';

export const AS_FINDINGS = {
  NO_ROBOTS_TXT: 'AS_NO_ROBOTS_TXT',
  ROBOTS_BLOCKS_AI: 'AS_ROBOTS_BLOCKS_AI',
  ROBOTS_PARTIAL_AI: 'AS_ROBOTS_PARTIAL_AI',
  ROBOTS_NO_SITEMAP: 'AS_ROBOTS_NO_SITEMAP',
  NO_LLMS_TXT: 'AS_NO_LLMS_TXT',
  LLMS_TXT_INVALID: 'AS_LLMS_TXT_INVALID',
  NO_LLMS_FULL: 'AS_NO_LLMS_FULL',
  NO_SITEMAP: 'AS_NO_SITEMAP',
  INVALID_SITEMAP: 'AS_INVALID_SITEMAP',
  NOT_HTTPS: 'AS_NOT_HTTPS',
} as const;

/** Bots we explicitly check for in robots.txt. Order is documentation-only. */
export const AI_BOTS = [
  'GPTBot',
  'ClaudeBot',
  'ClaudeUser',
  'PerplexityBot',
  'Google-Extended',
  'CCBot',
  'anthropic-ai',
  'Bytespider',
] as const;

type RobotsRule = { userAgent: string; allow: string[]; disallow: string[] };
type ParsedRobots = {
  groups: RobotsRule[];
  sitemaps: string[];
};

/**
 * Lightweight robots.txt parser. Treats lines as `key: value` (case-insensitive
 * key), groups Allow/Disallow under the most recent User-agent declaration.
 * Comments and blank lines are ignored. We don't try to be a perfect Google
 * implementation — we only need to answer "is bot X allowed at the root?".
 */
export function parseRobotsTxt(text: string): ParsedRobots {
  const groups: RobotsRule[] = [];
  const sitemaps: string[] = [];
  let current: RobotsRule | null = null;
  let lastWasUserAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line.length === 0) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      if (!lastWasUserAgent) {
        current = { userAgent: value, allow: [], disallow: [] };
        groups.push(current);
      } else if (current) {
        // Stacked user-agents share the same rule block. Push a sibling group
        // pointing at the same arrays so allow/disallow apply to both.
        const sibling: RobotsRule = {
          userAgent: value,
          allow: current.allow,
          disallow: current.disallow,
        };
        groups.push(sibling);
      }
      lastWasUserAgent = true;
      continue;
    }

    lastWasUserAgent = false;
    if (key === 'sitemap') {
      sitemaps.push(value);
      continue;
    }
    if (!current) continue;
    if (key === 'allow') current.allow.push(value);
    else if (key === 'disallow') current.disallow.push(value);
  }

  return { groups, sitemaps };
}

/**
 * Returns true if `bot` is allowed to fetch the site root according to
 * `parsed`. Resolution order: an explicit User-agent group for the bot wins
 * over the wildcard `*` group. An empty Disallow value means "allow all".
 */
export function botIsAllowed(parsed: ParsedRobots, bot: string): boolean {
  const lower = bot.toLowerCase();
  const matching = parsed.groups.find((g) => g.userAgent.toLowerCase() === lower);
  const fallback = parsed.groups.find((g) => g.userAgent === '*');
  const group = matching ?? fallback;
  if (!group) return true;
  // Per spec, Disallow: / blocks everything; Disallow: (empty) means allow.
  const blocksRoot = group.disallow.some((d) => d === '/' || d === '');
  // But Disallow: with empty value means "allow all" — handle that:
  const hasEmptyDisallow = group.disallow.some((d) => d === '');
  if (hasEmptyDisallow && !group.disallow.some((d) => d === '/')) return true;
  return !blocksRoot;
}

function parseLlmsTxt(text: string): {
  hasH1: boolean;
  sectionCount: number;
  hasFullLink: boolean;
  linkCount: number;
} {
  const lines = text.split(/\r?\n/);
  let hasH1 = false;
  let sectionCount = 0;
  let linkCount = 0;
  let hasFullLink = false;
  for (const line of lines) {
    if (/^#\s+\S/.test(line)) hasH1 = true;
    if (/^##\s+\S/.test(line)) sectionCount++;
    const linkMatches = line.match(/\[[^\]]+\]\([^)]+\)/g);
    if (linkMatches) {
      linkCount += linkMatches.length;
      for (const m of linkMatches) {
        if (/llms-full\.txt/i.test(m)) hasFullLink = true;
      }
    }
  }
  return { hasH1, sectionCount, hasFullLink, linkCount };
}

function isLikelyValidSitemap(xml: string): boolean {
  if (!/<\?xml/.test(xml)) return false;
  if (!/<urlset[\s>]/.test(xml) && !/<sitemapindex[\s>]/.test(xml)) return false;
  return true;
}

/**
 * Score (0-100) is the sum of:
 *  - robots.txt exists                     10
 *  - robots.txt allows AI bots             30 (proportional, all 8 = full)
 *  - robots.txt has Sitemap directive      10
 *  - llms.txt exists                       20
 *  - llms.txt follows the standard         10
 *  - sitemap.xml structurally valid        10
 *  - Final URL uses HTTPS                  10
 */
export const agentSignalsAnalyzer: Analyzer = (input): AnalyzerResult => {
  const findings: Finding[] = [];

  // ── robots.txt ───────────────────────────────────────────────────
  let robotsExistsScore = 0;
  let aiBotsScore = 0;
  let sitemapDirectiveScore = 0;
  let parsedRobots: ParsedRobots | null = null;
  if (input.robotsTxt && input.robotsTxt.trim().length > 0) {
    robotsExistsScore = 10;
    parsedRobots = parseRobotsTxt(input.robotsTxt);
    const allowed = AI_BOTS.filter((b) => botIsAllowed(parsedRobots!, b));
    const ratio = allowed.length / AI_BOTS.length;
    aiBotsScore = Math.round(ratio * 30);

    if (allowed.length === 0) {
      findings.push({
        id: AS_FINDINGS.ROBOTS_BLOCKS_AI,
        severity: 'high',
        title: 'robots.txt blocks every AI crawler we check for',
        description: `Blocks: ${AI_BOTS.join(', ')}.`,
      });
    } else if (allowed.length < AI_BOTS.length) {
      const blocked = AI_BOTS.filter((b) => !allowed.includes(b));
      findings.push({
        id: AS_FINDINGS.ROBOTS_PARTIAL_AI,
        severity: 'medium',
        title: `robots.txt blocks ${blocked.length} of ${AI_BOTS.length} AI crawlers`,
        description: `Blocked: ${blocked.join(', ')}.`,
      });
    }

    if (parsedRobots.sitemaps.length > 0) {
      sitemapDirectiveScore = 10;
    } else {
      findings.push({
        id: AS_FINDINGS.ROBOTS_NO_SITEMAP,
        severity: 'low',
        title: 'robots.txt has no Sitemap: directive',
        description: 'Adding `Sitemap: https://…/sitemap.xml` helps crawlers discover all pages.',
      });
    }
  } else {
    findings.push({
      id: AS_FINDINGS.NO_ROBOTS_TXT,
      severity: 'medium',
      title: 'No robots.txt',
      description:
        'Without robots.txt crawlers fall back to default behavior; site owners lose explicit control over what AI bots can index.',
    });
  }

  // ── llms.txt ─────────────────────────────────────────────────────
  let llmsExistsScore = 0;
  let llmsValidScore = 0;
  let llmsParsed: ReturnType<typeof parseLlmsTxt> | null = null;
  if (input.llmsTxt && input.llmsTxt.trim().length > 0) {
    llmsExistsScore = 20;
    llmsParsed = parseLlmsTxt(input.llmsTxt);
    if (llmsParsed.hasH1 && llmsParsed.sectionCount >= 1) {
      llmsValidScore = 10;
    } else {
      findings.push({
        id: AS_FINDINGS.LLMS_TXT_INVALID,
        severity: 'low',
        title: 'llms.txt does not follow the proposed structure',
        description:
          'Per llmstxt.org the file should start with an H1 (# Title) and contain at least one ## section.',
        evidence: snippet(input.llmsTxt, 200),
      });
    }
    if (!llmsParsed.hasFullLink) {
      findings.push({
        id: AS_FINDINGS.NO_LLMS_FULL,
        severity: 'info',
        title: 'llms.txt does not link to llms-full.txt',
        description:
          'Linking to a complete corpus (llms-full.txt) lets agents pull the full content without re-crawling.',
      });
    }
  } else {
    findings.push({
      id: AS_FINDINGS.NO_LLMS_TXT,
      severity: 'medium',
      title: 'No /llms.txt',
      description:
        'llms.txt is an emerging convention (llmstxt.org) for surfacing curated content paths to LLM agents.',
    });
  }

  // ── sitemap.xml ──────────────────────────────────────────────────
  let sitemapScore = 0;
  if (input.sitemapXml && input.sitemapXml.trim().length > 0) {
    if (isLikelyValidSitemap(input.sitemapXml)) {
      sitemapScore = 10;
    } else {
      findings.push({
        id: AS_FINDINGS.INVALID_SITEMAP,
        severity: 'medium',
        title: 'sitemap.xml does not look like a valid sitemap',
        description: 'Expected a <urlset> or <sitemapindex> root with an XML declaration.',
        evidence: snippet(input.sitemapXml, 200),
      });
    }
  } else {
    findings.push({
      id: AS_FINDINGS.NO_SITEMAP,
      severity: 'low',
      title: 'No sitemap.xml discovered',
      description:
        'A sitemap accelerates discovery for crawlers and is the canonical source of "what pages exist".',
    });
  }

  // ── HTTPS ────────────────────────────────────────────────────────
  let httpsScore = 0;
  let isHttps = false;
  try {
    const u = new URL(input.finalUrl);
    isHttps = u.protocol === 'https:';
  } catch {
    isHttps = false;
  }
  if (isHttps) {
    httpsScore = 10;
  } else {
    findings.push({
      id: AS_FINDINGS.NOT_HTTPS,
      severity: 'high',
      title: 'Site is not served over HTTPS',
      description: 'Most agents and modern browsers refuse or downgrade non-HTTPS targets.',
    });
  }

  const score = clampScore(
    robotsExistsScore +
      aiBotsScore +
      sitemapDirectiveScore +
      llmsExistsScore +
      llmsValidScore +
      sitemapScore +
      httpsScore,
  );

  return {
    score,
    findings,
    metrics: {
      robotsTxtPresent: !!input.robotsTxt,
      robotsSitemaps: parsedRobots?.sitemaps ?? [],
      aiBotsAllowed: parsedRobots ? AI_BOTS.filter((b) => botIsAllowed(parsedRobots!, b)) : [],
      aiBotsBlocked: parsedRobots ? AI_BOTS.filter((b) => !botIsAllowed(parsedRobots!, b)) : [],
      llmsTxtPresent: !!input.llmsTxt,
      llmsTxtParsed: llmsParsed,
      sitemapXmlPresent: !!input.sitemapXml,
      sitemapXmlValid: input.sitemapXml ? isLikelyValidSitemap(input.sitemapXml) : false,
      isHttps,
      subScores: {
        robotsExistsScore,
        aiBotsScore,
        sitemapDirectiveScore,
        llmsExistsScore,
        llmsValidScore,
        sitemapScore,
        httpsScore,
      },
    },
  };
};
