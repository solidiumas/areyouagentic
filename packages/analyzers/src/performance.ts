import type { Finding } from '@areyouagentic/shared';
import type { Analyzer, AnalyzerResult } from './types.js';
import { clampScore, linearScore, loadHtml } from './utils/dom.js';

export const PF_FINDINGS = {
  SLOW_TTFB: 'PF_SLOW_TTFB',
  HEAVY_PAGE: 'PF_HEAVY_PAGE',
  TOO_MANY_REQUESTS: 'PF_TOO_MANY_REQUESTS',
  SLOW_DCL: 'PF_SLOW_DCL',
  SLOW_NETWORK_IDLE: 'PF_SLOW_NETWORK_IDLE',
  COOKIE_BANNER_BLOCKING: 'PF_COOKIE_BANNER_BLOCKING',
} as const;

const COOKIE_KEYWORDS = /cookie|consent|gdpr|privacy/i;

/**
 * Heuristic detector for blocking cookie banners. Returns the count of
 * elements that look like a high-z-index modal mentioning consent/cookies.
 *
 * Looks for either:
 *  - inline style with z-index > 1000 + cookie/consent text, or
 *  - id/class containing cookie/consent words plus role="dialog" or fixed
 *    positioning hints in inline style.
 */
export function detectBlockingCookieBanners(html: string): number {
  const $ = loadHtml(html);
  let count = 0;
  $('[style], [id], [class], [role="dialog"], [aria-modal="true"]').each((_, el) => {
    const $el = $(el);
    const style = ($el.attr('style') ?? '').toLowerCase();
    const id = ($el.attr('id') ?? '').toLowerCase();
    const cls = ($el.attr('class') ?? '').toLowerCase();
    const role = ($el.attr('role') ?? '').toLowerCase();
    const ariaModal = $el.attr('aria-modal');
    const text = $el.text();

    const mentionsCookies = COOKIE_KEYWORDS.test(`${id} ${cls} ${text}`);
    if (!mentionsCookies) return;

    // High z-index in inline style?
    let highZ = false;
    const zMatch = style.match(/z-index\s*:\s*(\d+)/);
    if (zMatch) {
      const z = parseInt(zMatch[1] ?? '0', 10);
      if (z > 1000) highZ = true;
    }
    const isFixed = /position\s*:\s*(?:fixed|sticky)/.test(style);
    const isDialog = role === 'dialog' || ariaModal === 'true';

    if (highZ || (isFixed && (isDialog || mentionsCookies)) || isDialog) {
      count++;
    }
  });
  return count;
}

/**
 * Score (0-100) is the sum of:
 *  - TTFB                         30  (≤200ms full, ≥1500ms zero)
 *  - Page weight                  25  (≤500KB full, ≥5MB zero)
 *  - Request count                20  (≤30 full, ≥150 zero)
 *  - DOMContentLoaded             15  (≤1500ms full, ≥6000ms zero)
 *  - No blocking cookie banner    10  (zero detected)
 *
 * Network idle is captured for the report but not directly scored — DCL and
 * page weight already encode most of what would push it up.
 */
export const performanceAnalyzer: Analyzer = (input): AnalyzerResult => {
  const findings: Finding[] = [];
  const m = input.performanceMetrics;

  const ttfbScore = linearScore(m.ttfb, 200, 1500, 30);
  if (m.ttfb > 600) {
    findings.push({
      id: PF_FINDINGS.SLOW_TTFB,
      severity: m.ttfb > 1200 ? 'high' : 'medium',
      title: `Slow time-to-first-byte (${m.ttfb} ms)`,
      description: 'TTFB > 600 ms means the origin or upstream is slow before the browser even starts rendering. Agents waiting on you may time out.',
    });
  }

  const pageScore = linearScore(m.pageSize, 500_000, 5_000_000, 25);
  if (m.pageSize > 2_000_000) {
    findings.push({
      id: PF_FINDINGS.HEAVY_PAGE,
      severity: m.pageSize > 4_000_000 ? 'high' : 'medium',
      title: `Heavy page (${(m.pageSize / 1_000_000).toFixed(2)} MB)`,
      description: 'Large payloads slow agents on metered or batched connections and inflate token cost when ingesting the page.',
    });
  }

  const reqScore = linearScore(m.numRequests, 30, 150, 20);
  if (m.numRequests > 80) {
    findings.push({
      id: PF_FINDINGS.TOO_MANY_REQUESTS,
      severity: m.numRequests > 120 ? 'medium' : 'low',
      title: `${m.numRequests} network requests`,
      description: 'A high request count delays network idle and increases the chance an agent gives up before the page settles.',
    });
  }

  const dclScore = linearScore(m.domContentLoaded, 1500, 6000, 15);
  if (m.domContentLoaded > 3000) {
    findings.push({
      id: PF_FINDINGS.SLOW_DCL,
      severity: m.domContentLoaded > 5000 ? 'medium' : 'low',
      title: `DOMContentLoaded took ${m.domContentLoaded} ms`,
      description: 'Slow DCL usually means render-blocking JS or CSS in the head.',
    });
  }

  if (m.networkIdle > 10_000) {
    findings.push({
      id: PF_FINDINGS.SLOW_NETWORK_IDLE,
      severity: 'low',
      title: `Network did not go idle until ${m.networkIdle} ms`,
      description: 'Long-tail requests (analytics, polling, ads) keep the network busy and confuse "page is ready" heuristics.',
    });
  }

  const banners = detectBlockingCookieBanners(input.renderedHtml);
  let bannerScore: number;
  if (banners === 0) {
    bannerScore = 10;
  } else if (banners === 1) {
    bannerScore = 5;
    findings.push({
      id: PF_FINDINGS.COOKIE_BANNER_BLOCKING,
      severity: 'medium',
      title: 'Blocking cookie/consent banner detected',
      description: 'High-z-index dialogs that intercept the viewport prevent agents from interacting with the page until dismissed.',
    });
  } else {
    bannerScore = 0;
    findings.push({
      id: PF_FINDINGS.COOKIE_BANNER_BLOCKING,
      severity: 'high',
      title: `${banners} blocking dialogs detected`,
      description: 'Multiple modal overlays detected — typically cookie banner + newsletter + region prompt. Each one is friction for agents.',
    });
  }

  const score = clampScore(ttfbScore + pageScore + reqScore + dclScore + bannerScore);

  return {
    score,
    findings,
    metrics: {
      ttfb: m.ttfb,
      pageSize: m.pageSize,
      numRequests: m.numRequests,
      domContentLoaded: m.domContentLoaded,
      networkIdle: m.networkIdle,
      cookieBanners: banners,
      subScores: {
        ttfbScore,
        pageScore,
        reqScore,
        dclScore,
        bannerScore,
      },
    },
  };
};
