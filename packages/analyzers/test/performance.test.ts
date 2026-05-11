import { describe, expect, it } from 'vitest';
import { detectBlockingCookieBanners, performanceAnalyzer, PF_FINDINGS } from '../src/performance.js';
import { loadFixture, makeInput } from './helpers.js';

describe('performanceAnalyzer', () => {
  it('scores fast metrics + no banner near the top', () => {
    const result = performanceAnalyzer(
      makeInput({
        renderedHtml: loadFixture('ideal.html'),
        performanceMetrics: { ttfb: 120, pageSize: 250_000, numRequests: 18, domContentLoaded: 800, networkIdle: 1500 },
      }),
    );
    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.findings).toEqual([]);
  });

  it('penalizes a slow, heavy, request-heavy page', () => {
    const result = performanceAnalyzer(
      makeInput({
        renderedHtml: loadFixture('broken.html'),
        performanceMetrics: { ttfb: 1800, pageSize: 6_000_000, numRequests: 220, domContentLoaded: 7000, networkIdle: 12000 },
      }),
    );
    expect(result.score).toBeLessThan(20);
    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain(PF_FINDINGS.SLOW_TTFB);
    expect(ids).toContain(PF_FINDINGS.HEAVY_PAGE);
    expect(ids).toContain(PF_FINDINGS.TOO_MANY_REQUESTS);
    expect(ids).toContain(PF_FINDINGS.SLOW_DCL);
    expect(ids).toContain(PF_FINDINGS.SLOW_NETWORK_IDLE);
  });

  it('detects a blocking cookie banner on the news fixture', () => {
    const html = loadFixture('news-with-cookie-banner.html');
    expect(detectBlockingCookieBanners(html)).toBeGreaterThanOrEqual(1);
    const result = performanceAnalyzer(
      makeInput({
        renderedHtml: html,
        performanceMetrics: { ttfb: 200, pageSize: 600_000, numRequests: 35, domContentLoaded: 1700, networkIdle: 3500 },
      }),
    );
    expect(result.findings.map((f) => f.id)).toContain(PF_FINDINGS.COOKIE_BANNER_BLOCKING);
  });

  it('does not detect a banner where there is none', () => {
    const html = loadFixture('blog-article.html');
    expect(detectBlockingCookieBanners(html)).toBe(0);
  });

  it('uses linear interpolation between thresholds', () => {
    const a = performanceAnalyzer(
      makeInput({
        renderedHtml: loadFixture('ideal.html'),
        performanceMetrics: { ttfb: 200, pageSize: 500_000, numRequests: 30, domContentLoaded: 1500, networkIdle: 3000 },
      }),
    );
    const b = performanceAnalyzer(
      makeInput({
        renderedHtml: loadFixture('ideal.html'),
        performanceMetrics: { ttfb: 850, pageSize: 2_750_000, numRequests: 90, domContentLoaded: 3750, networkIdle: 5000 },
      }),
    );
    const c = performanceAnalyzer(
      makeInput({
        renderedHtml: loadFixture('ideal.html'),
        performanceMetrics: { ttfb: 1500, pageSize: 5_000_000, numRequests: 150, domContentLoaded: 6000, networkIdle: 5000 },
      }),
    );
    expect(a.score).toBeGreaterThan(b.score);
    expect(b.score).toBeGreaterThan(c.score);
  });

  it('rates a moderately slow product page in the middle', () => {
    const result = performanceAnalyzer(
      makeInput({
        renderedHtml: loadFixture('ecommerce-product.html'),
        performanceMetrics: { ttfb: 500, pageSize: 1_500_000, numRequests: 60, domContentLoaded: 2500, networkIdle: 4500 },
      }),
    );
    expect(result.score).toBeGreaterThan(50);
    expect(result.score).toBeLessThan(95);
  });

  it('produces a stable snapshot for the fast ideal scenario', () => {
    const result = performanceAnalyzer(
      makeInput({
        renderedHtml: loadFixture('ideal.html'),
        performanceMetrics: { ttfb: 120, pageSize: 250_000, numRequests: 18, domContentLoaded: 800, networkIdle: 1500 },
      }),
    );
    expect({ score: result.score, findingIds: result.findings.map((f) => f.id).sort() }).toMatchSnapshot();
  });
});
