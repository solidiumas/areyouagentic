import { describe, expect, it } from 'vitest';
import { machineReadabilityAnalyzer, MR_FINDINGS } from '../src/machineReadability.js';
import { loadFixture, makeInput } from './helpers.js';

describe('machineReadabilityAnalyzer', () => {
  it('scores the ideal SSR page near the top of the range', () => {
    const html = loadFixture('ideal.html');
    const result = machineReadabilityAnalyzer(makeInput({ renderedHtml: html }));
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.findings.map((f) => f.id)).toEqual([]);
  });

  it('scores the broken div-soup near zero and surfaces the right findings', () => {
    const html = loadFixture('broken.html');
    const result = machineReadabilityAnalyzer(makeInput({ renderedHtml: html }));
    expect(result.score).toBeLessThan(40);
    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain(MR_FINDINGS.NO_SEMANTIC_TAGS);
    expect(ids).toContain(MR_FINDINGS.CLICKABLE_DIVS);
    expect(ids).toContain(MR_FINDINGS.MISSING_H1);
    expect(ids).toContain(MR_FINDINGS.NO_LANDMARKS);
  });

  it('flags high JS dependence when raw HTML is an empty SPA shell', () => {
    const raw = loadFixture('spa-shell.html');
    const rendered = loadFixture('spa-rendered.html');
    const result = machineReadabilityAnalyzer(makeInput({ rawHtml: raw, renderedHtml: rendered }));
    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain(MR_FINDINGS.HIGH_JS_DEPENDENCE);
    expect((result.metrics as { rawCoverage: number }).rawCoverage).toBeLessThan(0.3);
  });

  it('rates a blog article as semantically strong but flags missing landmarks subtleties', () => {
    const html = loadFixture('blog-article.html');
    const result = machineReadabilityAnalyzer(makeInput({ renderedHtml: html }));
    expect(result.score).toBeGreaterThan(70);
  });

  it('rates an e-commerce product page well above the marketing thin page', () => {
    const product = machineReadabilityAnalyzer(
      makeInput({ renderedHtml: loadFixture('ecommerce-product.html') }),
    );
    const thin = machineReadabilityAnalyzer(makeInput({ renderedHtml: loadFixture('marketing-thin.html') }));
    expect(product.score).toBeGreaterThan(thin.score);
  });

  it('flags heading-skip when the page jumps from h1 to h3', () => {
    const html = loadFixture('marketing-thin.html');
    const result = machineReadabilityAnalyzer(makeInput({ renderedHtml: html }));
    expect(result.findings.map((f) => f.id)).toContain(MR_FINDINGS.HEADING_SKIP);
  });

  it('produces a stable snapshot for the ideal fixture', () => {
    const html = loadFixture('ideal.html');
    const result = machineReadabilityAnalyzer(makeInput({ renderedHtml: html }));
    expect({ score: result.score, findingIds: result.findings.map((f) => f.id).sort() }).toMatchSnapshot();
  });
});
