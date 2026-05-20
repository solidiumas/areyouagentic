import type { Finding } from '@areyouagentic/shared';
import type { Analyzer, AnalyzerResult } from './types.js';
import { clampScore, loadHtml, snippet } from './utils/dom.js';

export const SD_FINDINGS = {
  MISSING_JSON_LD: 'SD_MISSING_JSON_LD',
  INVALID_JSON_LD: 'SD_INVALID_JSON_LD',
  JSON_LD_NO_CONTEXT: 'SD_JSON_LD_NO_CONTEXT',
  JSON_LD_NO_TYPE: 'SD_JSON_LD_NO_TYPE',
  UNKNOWN_SCHEMA_TYPE: 'SD_UNKNOWN_SCHEMA_TYPE',
  MISSING_OG_TAGS: 'SD_MISSING_OG_TAGS',
  PARTIAL_OG_TAGS: 'SD_PARTIAL_OG_TAGS',
  MISSING_TWITTER_CARD: 'SD_MISSING_TWITTER_CARD',
  MISSING_CANONICAL: 'SD_MISSING_CANONICAL',
  NO_HREFLANG: 'SD_NO_HREFLANG',
  NO_MICRODATA: 'SD_NO_MICRODATA',
  CONTENT_SCHEMA_MISMATCH: 'SD_CONTENT_SCHEMA_MISMATCH',
} as const;

const KNOWN_SCHEMA_TYPES = new Set([
  'Organization',
  'LocalBusiness',
  'Person',
  'Product',
  'Offer',
  'AggregateRating',
  'Review',
  'FAQPage',
  'Question',
  'Article',
  'NewsArticle',
  'BlogPosting',
  'Recipe',
  'Event',
  'BreadcrumbList',
  'WebSite',
  'WebPage',
  'VideoObject',
  'ImageObject',
  'HowTo',
  'JobPosting',
  'Course',
  'SoftwareApplication',
  'Book',
  'Movie',
]);

const REQUIRED_OG = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'] as const;

type ParsedJsonLd =
  | { ok: true; data: unknown; types: string[]; hasContext: boolean; raw: string }
  | { ok: false; error: string; raw: string };

function parseJsonLdBlock(raw: string): ParsedJsonLd {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'parse error', raw };
  }
  const types = collectTypes(data);
  const hasContext = collectContexts(data).length > 0;
  return { ok: true, data, types, hasContext, raw };
}

function collectTypes(value: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const t = obj['@type'];
      if (typeof t === 'string') out.push(t);
      else if (Array.isArray(t)) for (const tt of t) if (typeof tt === 'string') out.push(tt);
      // Don't recurse into @graph children for type extraction beyond their own @type — that's fine, do it.
      for (const key of Object.keys(obj)) {
        if (key === '@type') continue;
        visit(obj[key]);
      }
    }
  };
  visit(value);
  return out;
}

function collectContexts(value: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const c = obj['@context'];
      if (typeof c === 'string') out.push(c);
      else if (Array.isArray(c)) for (const cc of c) if (typeof cc === 'string') out.push(cc);
    }
  };
  visit(value);
  return out;
}

/**
 * Score (0-100) is the sum of:
 *  - JSON-LD present + valid + recognized type   30
 *  - OpenGraph completeness                       20 (4 pts × 5 required tags)
 *  - Twitter Cards                                 5
 *  - Microdata (itemscope/itemprop)                5
 *  - Canonical URL                                10
 *  - hreflang (or no-penalty if monolingual)      10
 *  - Content/schema name alignment bonus          20
 */
export const structuredDataAnalyzer: Analyzer = (input): AnalyzerResult => {
  const findings: Finding[] = [];
  const $ = loadHtml(input.renderedHtml);

  // ── JSON-LD ──────────────────────────────────────────────────────
  const jsonLdBlocks: ParsedJsonLd[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    if (raw.trim().length === 0) return;
    jsonLdBlocks.push(parseJsonLdBlock(raw));
  });

  let jsonLdScore = 0;
  const allTypes: string[] = [];
  if (jsonLdBlocks.length === 0) {
    findings.push({
      id: SD_FINDINGS.MISSING_JSON_LD,
      severity: 'medium',
      title: 'No JSON-LD structured data',
      description:
        'Pages without JSON-LD give crawlers no canonical schema for entities on the page (organization, product, article, etc.).',
    });
  } else {
    const valid = jsonLdBlocks.filter((b) => b.ok);
    const invalid = jsonLdBlocks.filter((b) => !b.ok);
    if (invalid.length > 0) {
      findings.push({
        id: SD_FINDINGS.INVALID_JSON_LD,
        severity: 'high',
        title: `Invalid JSON in ${invalid.length} JSON-LD block(s)`,
        description: "Crawlers will skip blocks that don't parse as JSON.",
        evidence: snippet(invalid[0]?.raw ?? ''),
      });
    }

    if (valid.length > 0) {
      jsonLdScore += 10;
      const withContext = valid.filter((b) => b.ok && b.hasContext);
      if (withContext.length === 0) {
        findings.push({
          id: SD_FINDINGS.JSON_LD_NO_CONTEXT,
          severity: 'medium',
          title: 'JSON-LD blocks missing @context',
          description:
            "Without @context (typically https://schema.org), parsers can't resolve types.",
        });
      } else {
        jsonLdScore += 5;
      }

      for (const b of valid) if (b.ok) allTypes.push(...b.types);
      if (allTypes.length === 0) {
        findings.push({
          id: SD_FINDINGS.JSON_LD_NO_TYPE,
          severity: 'medium',
          title: 'JSON-LD blocks missing @type',
          description: '@type is required for entity classification.',
        });
      } else {
        jsonLdScore += 5;
        const recognized = allTypes.filter((t) => KNOWN_SCHEMA_TYPES.has(t));
        if (recognized.length === 0) {
          findings.push({
            id: SD_FINDINGS.UNKNOWN_SCHEMA_TYPE,
            severity: 'low',
            title: `JSON-LD types not recognized: ${allTypes.join(', ')}`,
            description:
              'Using a known schema.org type makes the data more useful to mainstream crawlers.',
          });
        } else {
          jsonLdScore += 10;
        }
      }
    }
  }

  // ── OpenGraph ────────────────────────────────────────────────────
  const ogPresent: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    const prop = $(el).attr('property');
    const content = $(el).attr('content');
    if (prop && content) ogPresent[prop] = content;
  });
  const ogPresentCount = REQUIRED_OG.filter((k) => ogPresent[k]).length;
  let ogScore = ogPresentCount * 4;
  if (ogPresentCount === 0) {
    findings.push({
      id: SD_FINDINGS.MISSING_OG_TAGS,
      severity: 'medium',
      title: 'No OpenGraph tags',
      description:
        'OpenGraph tags determine how a URL renders when shared on social media or pasted into chat clients.',
    });
  } else if (ogPresentCount < REQUIRED_OG.length) {
    findings.push({
      id: SD_FINDINGS.PARTIAL_OG_TAGS,
      severity: 'low',
      title: `OpenGraph incomplete (${ogPresentCount}/${REQUIRED_OG.length} required tags)`,
      description: `Missing: ${REQUIRED_OG.filter((k) => !ogPresent[k]).join(', ')}.`,
    });
  }

  // ── Twitter Cards ────────────────────────────────────────────────
  const twitterCardType = $('meta[name="twitter:card"]').attr('content') ?? null;
  let twitterScore = 0;
  if (twitterCardType) {
    twitterScore = 5;
  } else {
    findings.push({
      id: SD_FINDINGS.MISSING_TWITTER_CARD,
      severity: 'info',
      title: 'No Twitter Card tag',
      description: 'twitter:card tells X/Twitter how to render link previews.',
    });
  }

  // ── Microdata ────────────────────────────────────────────────────
  const microdataCount = $('[itemscope]').length;
  let microdataScore = 0;
  if (microdataCount > 0) {
    microdataScore = 5;
  } else {
    findings.push({
      id: SD_FINDINGS.NO_MICRODATA,
      severity: 'info',
      title: 'No microdata (itemscope/itemprop) annotations',
      description:
        "Microdata is a fallback for crawlers that don't parse JSON-LD. Optional if JSON-LD is solid.",
    });
  }
  // Don't double-penalize: if JSON-LD already covers it, microdata gap is informational.
  if (jsonLdScore < 20 && microdataCount === 0) {
    // already added the info finding above; we just don't credit the score
  }

  // ── Canonical ────────────────────────────────────────────────────
  const canonical = $('link[rel="canonical"]').attr('href') ?? null;
  let canonicalScore = 0;
  if (canonical) {
    canonicalScore = 10;
  } else {
    findings.push({
      id: SD_FINDINGS.MISSING_CANONICAL,
      severity: 'medium',
      title: 'No <link rel="canonical">',
      description:
        'Without a canonical URL, crawlers may treat tracking-parameter variants of this page as separate documents.',
    });
  }

  // ── hreflang ─────────────────────────────────────────────────────
  const hreflangCount = $('link[rel="alternate"][hreflang]').length;
  const htmlLang = $('html').attr('lang');
  let hreflangScore: number;
  if (hreflangCount > 0) {
    hreflangScore = 10;
  } else if (!htmlLang) {
    hreflangScore = 5;
    findings.push({
      id: SD_FINDINGS.NO_HREFLANG,
      severity: 'low',
      title: 'No hreflang and no <html lang> declared',
      description:
        'Declare the page language with <html lang="…"> at minimum so crawlers know which natural language to expect.',
    });
  } else {
    // Monolingual site that declares its language is fine.
    hreflangScore = 8;
  }

  // ── Content / schema alignment ───────────────────────────────────
  const ogTitle = ogPresent['og:title'];
  const titleTag = $('title').first().text().trim();
  let alignmentScore = 0;
  if (allTypes.length > 0 && (ogTitle || titleTag)) {
    // Simple heuristic: if og:title and title disagree wildly we deduct.
    if (ogTitle && titleTag) {
      const overlap = jaccardWords(ogTitle, titleTag);
      alignmentScore = overlap >= 0.4 ? 20 : 10;
      if (overlap < 0.2) {
        findings.push({
          id: SD_FINDINGS.CONTENT_SCHEMA_MISMATCH,
          severity: 'low',
          title: 'og:title and <title> disagree',
          description: `og:title "${snippet(ogTitle, 60)}" and <title> "${snippet(titleTag, 60)}" share few words. Pick one canonical title.`,
        });
      }
    } else {
      alignmentScore = 10;
    }
  }

  const score = clampScore(
    jsonLdScore +
      ogScore +
      twitterScore +
      microdataScore +
      canonicalScore +
      hreflangScore +
      alignmentScore,
  );

  return {
    score,
    findings,
    metrics: {
      jsonLdBlockCount: jsonLdBlocks.length,
      jsonLdValidCount: jsonLdBlocks.filter((b) => b.ok).length,
      jsonLdTypes: allTypes,
      ogPresent,
      ogPresentCount,
      twitterCardType,
      microdataCount,
      canonical,
      hreflangCount,
      htmlLang: htmlLang ?? null,
      titleTag,
      subScores: {
        jsonLdScore,
        ogScore,
        twitterScore,
        microdataScore,
        canonicalScore,
        hreflangScore,
        alignmentScore,
      },
    },
  };
};

function jaccardWords(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  const A = tok(a);
  const B = tok(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}
