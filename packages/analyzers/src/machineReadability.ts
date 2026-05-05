import type { Finding } from '@areyouagentic/shared';
import type { Analyzer, AnalyzerResult } from './types.js';
import { clampScore, countTags, loadHtml, snippet } from './utils/dom.js';
import { compareRawVsRendered } from './utils/compare.js';

/**
 * Stable IDs for findings produced by this analyzer. Frontend renders a
 * fixed copy block per ID, so once an ID ships it must not be renamed
 * without a migration plan for cached reports.
 */
export const MR_FINDINGS = {
  HIGH_JS_DEPENDENCE: 'MR_HIGH_JS_DEPENDENCE',
  MODERATE_JS_DEPENDENCE: 'MR_MODERATE_JS_DEPENDENCE',
  NO_SEMANTIC_TAGS: 'MR_NO_SEMANTIC_TAGS',
  LOW_SEMANTIC_RATIO: 'MR_LOW_SEMANTIC_RATIO',
  CLICKABLE_DIVS: 'MR_CLICKABLE_DIVS',
  MISSING_H1: 'MR_MISSING_H1',
  MULTIPLE_H1: 'MR_MULTIPLE_H1',
  HEADING_SKIP: 'MR_HEADING_SKIP',
  NO_LANDMARKS: 'MR_NO_LANDMARKS',
  CONTENT_IN_IFRAME: 'MR_CONTENT_IN_IFRAME',
} as const;

const SEMANTIC_TAGS = ['main', 'article', 'nav', 'header', 'footer', 'section', 'aside'] as const;
const LANDMARK_TAGS = ['main', 'nav', 'header', 'footer'] as const;

/**
 * Score (0-100) is the sum of six sub-scores:
 *  - Raw vs rendered text parity         25
 *  - Semantic-tag density                20
 *  - Real `<button>` use vs clickable    15
 *  - Heading hierarchy                   15
 *  - Landmark presence                   10
 *  - Content-not-trapped-in-iframe       15
 *
 * Each sub-score is independently capped, then summed and clamped to [0,100].
 */
export const machineReadabilityAnalyzer: Analyzer = (input): AnalyzerResult => {
  const findings: Finding[] = [];
  const $rend = loadHtml(input.renderedHtml);

  // ── Raw vs rendered ──────────────────────────────────────────────
  const cmp = compareRawVsRendered(input.rawHtml, input.renderedHtml);
  let rawScore: number;
  if (cmp.rawCoverage >= 0.9) {
    rawScore = 25;
  } else if (cmp.rawCoverage >= 0.6) {
    rawScore = 18;
  } else if (cmp.rawCoverage >= 0.3) {
    rawScore = 10;
    findings.push({
      id: MR_FINDINGS.MODERATE_JS_DEPENDENCE,
      severity: 'medium',
      title: 'Significant content depends on JavaScript',
      description: `Only ${(cmp.rawCoverage * 100).toFixed(0)}% of visible text is in the raw HTML; the rest is injected by client-side scripts. Many crawlers and AI agents skip JS, so they will see a partial page.`,
      evidence: snippet(cmp.jsOnlyTextNodes.slice(0, 3).join(' | ')),
    });
  } else {
    rawScore = 0;
    findings.push({
      id: MR_FINDINGS.HIGH_JS_DEPENDENCE,
      severity: 'high',
      title: 'Page content is almost entirely rendered by JavaScript',
      description: `Raw HTML contains only ${(cmp.rawCoverage * 100).toFixed(0)}% of the visible text. Non-rendering crawlers will see an empty shell.`,
      evidence: snippet(cmp.jsOnlyTextNodes.slice(0, 3).join(' | ')),
    });
  }

  // ── Semantic tag density ─────────────────────────────────────────
  const semanticCounts = countTags($rend, SEMANTIC_TAGS);
  const semanticTotal = Object.values(semanticCounts).reduce((a, b) => a + b, 0);
  const divCount = $rend('div').length;
  const semanticRatio = divCount === 0 ? (semanticTotal > 0 ? 1 : 0) : semanticTotal / (semanticTotal + divCount);

  let semanticScore: number;
  if (semanticTotal === 0) {
    semanticScore = 0;
    findings.push({
      id: MR_FINDINGS.NO_SEMANTIC_TAGS,
      severity: 'high',
      title: 'No semantic HTML5 tags found',
      description: 'The page uses only generic <div> elements. Semantic tags like <main>, <article>, and <nav> help agents understand page structure.',
    });
  } else if (semanticRatio < 0.05) {
    semanticScore = 8;
    findings.push({
      id: MR_FINDINGS.LOW_SEMANTIC_RATIO,
      severity: 'medium',
      title: 'Semantic tags are sparse compared to <div>s',
      description: `Found ${semanticTotal} semantic tags vs ${divCount} divs (ratio ${(semanticRatio * 100).toFixed(1)}%).`,
    });
  } else if (semanticRatio < 0.15) {
    semanticScore = 14;
  } else {
    semanticScore = 20;
  }

  // ── Real buttons ─────────────────────────────────────────────────
  const realButtons = $rend('button, a[href], input[type=submit], input[type=button]').length;
  const clickableDivs = $rend('div[onclick], span[onclick], div[role=button], span[role=button]').length;
  let buttonScore: number;
  if (clickableDivs === 0) {
    buttonScore = 15;
  } else if (clickableDivs <= realButtons / 4) {
    buttonScore = 10;
  } else {
    buttonScore = 0;
    findings.push({
      id: MR_FINDINGS.CLICKABLE_DIVS,
      severity: 'medium',
      title: 'Interactive elements use <div>/<span> instead of <button>',
      description: `Found ${clickableDivs} click-handler divs/spans alongside ${realButtons} real buttons/links. Agents can't reliably identify these as actions.`,
    });
  }

  // ── Heading hierarchy ────────────────────────────────────────────
  const h1Count = $rend('h1').length;
  const headingLevels: number[] = [];
  $rend('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const tag = (el as { name?: string }).name;
    if (tag) headingLevels.push(parseInt(tag.slice(1), 10));
  });

  let headingScore = 15;
  if (h1Count === 0) {
    headingScore -= 10;
    findings.push({
      id: MR_FINDINGS.MISSING_H1,
      severity: 'medium',
      title: 'No <h1> on the page',
      description: 'Every page should have exactly one <h1> describing the primary topic.',
    });
  } else if (h1Count > 1) {
    headingScore -= 5;
    findings.push({
      id: MR_FINDINGS.MULTIPLE_H1,
      severity: 'low',
      title: `Multiple <h1> tags found (${h1Count})`,
      description: 'Multiple top-level headings dilute the page topic for crawlers and screen readers.',
    });
  }

  let skipped = false;
  for (let i = 1; i < headingLevels.length; i++) {
    const prev = headingLevels[i - 1]!;
    const curr = headingLevels[i]!;
    if (curr - prev > 1) {
      skipped = true;
      break;
    }
  }
  if (skipped) {
    headingScore = Math.max(0, headingScore - 5);
    findings.push({
      id: MR_FINDINGS.HEADING_SKIP,
      severity: 'low',
      title: 'Heading levels skipped',
      description: `Heading sequence jumps levels (e.g. h1 → h3). Sequence: ${headingLevels.join('→')}.`,
    });
  }

  // ── Landmarks ────────────────────────────────────────────────────
  const landmarkCounts = countTags($rend, LANDMARK_TAGS);
  const presentLandmarks = LANDMARK_TAGS.filter((t) => (landmarkCounts[t] ?? 0) > 0);
  let landmarkScore: number;
  if (presentLandmarks.length === 0) {
    landmarkScore = 0;
    findings.push({
      id: MR_FINDINGS.NO_LANDMARKS,
      severity: 'medium',
      title: 'No landmark elements (<main>, <nav>, <header>, <footer>)',
      description: 'Landmarks let agents and assistive tech jump to the main content; without them the page is one undifferentiated blob.',
    });
  } else if (presentLandmarks.length < 2) {
    landmarkScore = 5;
  } else {
    landmarkScore = 10;
  }

  // ── Iframes ──────────────────────────────────────────────────────
  const iframeCount = $rend('iframe').length;
  const totalChars = Math.max(1, input.renderedHtml.length);
  // Approximate per-iframe weight as the iframe's HTML excluding its src/attrs.
  let iframeChars = 0;
  $rend('iframe').each((_, el) => {
    const html = $rend.html(el);
    if (html) iframeChars += html.length;
  });
  const iframeRatio = iframeChars / totalChars;
  let iframeScore: number;
  if (iframeRatio < 0.05) {
    iframeScore = 15;
  } else if (iframeRatio < 0.2) {
    iframeScore = 8;
  } else {
    iframeScore = 0;
    findings.push({
      id: MR_FINDINGS.CONTENT_IN_IFRAME,
      severity: 'medium',
      title: 'A large share of the page is inside <iframe>s',
      description: `Roughly ${(iframeRatio * 100).toFixed(0)}% of the rendered HTML is iframe content; agents won't follow the iframe boundary by default.`,
    });
  }

  const score = clampScore(rawScore + semanticScore + buttonScore + headingScore + landmarkScore + iframeScore);

  return {
    score,
    findings,
    metrics: {
      rawCoverage: cmp.rawCoverage,
      rawTextChars: cmp.rawTextChars,
      renderedTextChars: cmp.renderedTextChars,
      semanticCounts,
      divCount,
      semanticRatio,
      realButtons,
      clickableDivs,
      h1Count,
      headingLevels,
      landmarkCounts,
      iframeCount,
      iframeRatio,
      subScores: {
        rawScore,
        semanticScore,
        buttonScore,
        headingScore,
        landmarkScore,
        iframeScore,
      },
    },
  };
};
