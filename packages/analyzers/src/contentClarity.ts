import type { Finding } from '@areyouagentic/shared';
import type { Analyzer, AnalyzerResult } from './types.js';
import { clampScore, getVisibleText, loadHtml, snippet } from './utils/dom.js';

export const CC_FINDINGS = {
  TITLE_MISSING: 'CC_TITLE_MISSING',
  TITLE_TOO_SHORT: 'CC_TITLE_TOO_SHORT',
  TITLE_TOO_LONG: 'CC_TITLE_TOO_LONG',
  META_DESC_MISSING: 'CC_META_DESC_MISSING',
  META_DESC_TOO_SHORT: 'CC_META_DESC_TOO_SHORT',
  META_DESC_TOO_LONG: 'CC_META_DESC_TOO_LONG',
  H1_MISSING: 'CC_H1_MISSING',
  H1_TITLE_MISMATCH: 'CC_H1_TITLE_MISMATCH',
  LOW_READABILITY: 'CC_LOW_READABILITY',
  HIGH_BOILERPLATE: 'CC_HIGH_BOILERPLATE',
  THIN_CONTENT: 'CC_THIN_CONTENT',
} as const;

const BOILERPLATE_TAGS = ['header', 'footer', 'nav', 'aside'] as const;

/**
 * Identify the page's main content container. We don't pull in mozilla/readability
 * to keep the package dep-light; instead we use a tag priority:
 *  1. <main>
 *  2. <article>
 *  3. The largest <section>
 *  4. <body> minus boilerplate (header/footer/nav/aside)
 */
export function findMainContentText(html: string): { text: string; selector: string } {
  const $ = loadHtml(html);

  const main = $('main').first();
  if (main.length > 0) return { text: textOf($, main), selector: 'main' };

  const article = $('article').first();
  if (article.length > 0) return { text: textOf($, article), selector: 'article' };

  let bestSection: { len: number; el: ReturnType<typeof $> } | null = null;
  $('section').each((_, el) => {
    const $el = $(el);
    const len = $el.text().trim().length;
    if (!bestSection || len > bestSection.len) bestSection = { len, el: $el };
  });
  if (bestSection !== null) {
    const found = bestSection as { len: number; el: ReturnType<typeof $> };
    if (found.len > 200) return { text: textOf($, found.el), selector: 'section' };
  }

  const $body = $('body').clone();
  for (const tag of BOILERPLATE_TAGS) $body.find(tag).remove();
  $body.find('script, style, noscript, template').remove();
  return { text: $body.text().replace(/\s+/g, ' ').trim(), selector: 'body-minus-boilerplate' };
}

function textOf(
  $: ReturnType<typeof loadHtml>,
  el: ReturnType<ReturnType<typeof loadHtml>>,
): string {
  const clone = el.clone();
  clone.find('script, style, noscript, template').remove();
  return clone.text().replace(/\s+/g, ' ').trim();
  void $;
}

/**
 * Flesch Reading Ease, normalized to 0-100. Higher is easier.
 * Formula: 206.835 - 1.015 * (words/sentences) - 84.6 * (syllables/words).
 * Returns 0 if there's not enough text to score.
 */
export function fleschReadingEase(text: string): number {
  const words = text.match(/[A-Za-zÀ-ÿ]+(?:[''][A-Za-zÀ-ÿ]+)*/g) ?? [];
  if (words.length < 30) return 0;
  const sentences = (text.match(/[.!?]+\s|[.!?]+$/g) ?? []).length || 1;
  let syllables = 0;
  for (const w of words) syllables += syllableCount(w);
  const score = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length);
  return Math.max(0, Math.min(100, score));
}

function syllableCount(word: string): number {
  const w = word.toLowerCase().replace(/[^a-zà-ÿ]/g, '');
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = stripped.match(/[aeiouyà-ÿ]+/g);
  return Math.max(1, groups?.length ?? 1);
}

/**
 * Score (0-100) is the sum of:
 *  - Title length 10-70 chars         20
 *  - Meta description 50-160 chars    20
 *  - H1 exists & matches title        15
 *  - Readability (Flesch)             15
 *  - Boilerplate ratio is low         15  (1 - boilerplate/total)
 *  - Main content word count          15
 */
export const contentClarityAnalyzer: Analyzer = (input): AnalyzerResult => {
  const findings: Finding[] = [];
  const $ = loadHtml(input.renderedHtml);

  // ── Title ────────────────────────────────────────────────────────
  const title = $('title').first().text().trim();
  let titleScore = 0;
  if (title.length === 0) {
    findings.push({
      id: CC_FINDINGS.TITLE_MISSING,
      severity: 'high',
      title: 'Page is missing a <title>',
      description: '<title> is the most important single piece of content metadata.',
    });
  } else if (title.length < 10) {
    titleScore = 8;
    findings.push({
      id: CC_FINDINGS.TITLE_TOO_SHORT,
      severity: 'medium',
      title: `<title> is ${title.length} characters (under 10)`,
      description: 'A descriptive title is typically 30-60 characters.',
      evidence: snippet(title, 80),
    });
  } else if (title.length > 70) {
    titleScore = 12;
    findings.push({
      id: CC_FINDINGS.TITLE_TOO_LONG,
      severity: 'low',
      title: `<title> is ${title.length} characters (over 70)`,
      description: 'Long titles get truncated in search results and chat link previews.',
      evidence: snippet(title, 100),
    });
  } else {
    titleScore = 20;
  }

  // ── Meta description ─────────────────────────────────────────────
  const metaDesc = $('meta[name="description"]').attr('content')?.trim() ?? '';
  let metaScore = 0;
  if (metaDesc.length === 0) {
    findings.push({
      id: CC_FINDINGS.META_DESC_MISSING,
      severity: 'medium',
      title: 'No meta description',
      description:
        'A 50-160 character description controls search snippets and chat-app link previews.',
    });
  } else if (metaDesc.length < 50) {
    metaScore = 10;
    findings.push({
      id: CC_FINDINGS.META_DESC_TOO_SHORT,
      severity: 'low',
      title: `Meta description is ${metaDesc.length} characters (under 50)`,
      description: 'Short descriptions waste a free preview slot.',
      evidence: snippet(metaDesc, 200),
    });
  } else if (metaDesc.length > 160) {
    metaScore = 14;
    findings.push({
      id: CC_FINDINGS.META_DESC_TOO_LONG,
      severity: 'low',
      title: `Meta description is ${metaDesc.length} characters (over 160)`,
      description: 'Most search and chat clients truncate around 155-160 characters.',
      evidence: snippet(metaDesc, 200),
    });
  } else {
    metaScore = 20;
  }

  // ── H1 + title alignment ─────────────────────────────────────────
  const h1Text = $('h1').first().text().trim();
  let h1Score = 0;
  if (h1Text.length === 0) {
    findings.push({
      id: CC_FINDINGS.H1_MISSING,
      severity: 'medium',
      title: 'No <h1> on the page',
      description: 'Every page should have one <h1> describing its primary topic.',
    });
  } else {
    const overlap = jaccardWords(h1Text, title);
    if (title.length > 0 && overlap < 0.2) {
      h1Score = 8;
      findings.push({
        id: CC_FINDINGS.H1_TITLE_MISMATCH,
        severity: 'low',
        title: '<h1> and <title> share few words',
        description: `<title> "${snippet(title, 60)}" and <h1> "${snippet(h1Text, 60)}" disagree on the page topic.`,
      });
    } else {
      h1Score = 15;
    }
  }

  // ── Readability ──────────────────────────────────────────────────
  const main = findMainContentText(input.renderedHtml);
  const flesch = fleschReadingEase(main.text);
  let readabilityScore: number;
  if (flesch === 0) {
    // Not enough text to compute — give partial credit; thin-content finding handles this elsewhere.
    readabilityScore = 8;
  } else if (flesch < 30) {
    readabilityScore = 5;
    findings.push({
      id: CC_FINDINGS.LOW_READABILITY,
      severity: 'low',
      title: `Low readability (Flesch ${flesch.toFixed(0)})`,
      description:
        'Long sentences and complex words make the page hard for both humans and agents to summarize.',
    });
  } else if (flesch < 50) {
    readabilityScore = 10;
  } else {
    readabilityScore = 15;
  }

  // ── Boilerplate ratio ────────────────────────────────────────────
  let boilerplateChars = 0;
  for (const tag of BOILERPLATE_TAGS) {
    $(tag).each((_, el) => {
      boilerplateChars += $(el).text().trim().length;
    });
  }
  const totalText = getVisibleText($).length;
  const boilerplateRatio = totalText === 0 ? 0 : boilerplateChars / totalText;
  let boilerplateScore: number;
  if (boilerplateRatio < 0.3) {
    boilerplateScore = 15;
  } else if (boilerplateRatio < 0.6) {
    boilerplateScore = 8;
  } else {
    boilerplateScore = 0;
    findings.push({
      id: CC_FINDINGS.HIGH_BOILERPLATE,
      severity: 'medium',
      title: `${(boilerplateRatio * 100).toFixed(0)}% of visible text is boilerplate`,
      description: 'Most of the page is header/footer/nav text. Add unique, on-topic content.',
    });
  }

  // ── Word count ───────────────────────────────────────────────────
  const mainWordCount = (main.text.match(/\S+/g) ?? []).length;
  let wordCountScore: number;
  if (mainWordCount >= 300) {
    wordCountScore = 15;
  } else if (mainWordCount >= 100) {
    wordCountScore = 8;
  } else {
    wordCountScore = 0;
    findings.push({
      id: CC_FINDINGS.THIN_CONTENT,
      severity: mainWordCount < 30 ? 'medium' : 'low',
      title: `Thin main content (${mainWordCount} words)`,
      description:
        'Pages under ~100 words rarely give an agent enough material to answer questions about the topic.',
    });
  }

  const score = clampScore(
    titleScore + metaScore + h1Score + readabilityScore + boilerplateScore + wordCountScore,
  );

  return {
    score,
    findings,
    metrics: {
      title,
      titleLength: title.length,
      metaDescription: metaDesc,
      metaDescriptionLength: metaDesc.length,
      h1Text,
      mainContentSelector: main.selector,
      mainWordCount,
      flesch,
      boilerplateRatio,
      subScores: {
        titleScore,
        metaScore,
        h1Score,
        readabilityScore,
        boilerplateScore,
        wordCountScore,
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
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}
