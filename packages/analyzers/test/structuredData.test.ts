import { describe, expect, it } from 'vitest';
import { SD_FINDINGS, structuredDataAnalyzer } from '../src/structuredData.js';
import { loadFixture, makeInput } from './helpers.js';

describe('structuredDataAnalyzer', () => {
  it('scores the ideal page near the top', () => {
    const html = loadFixture('ideal.html');
    const result = structuredDataAnalyzer(makeInput({ renderedHtml: html }));
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect((result.metrics as { jsonLdTypes: string[] }).jsonLdTypes).toContain('Organization');
  });

  it('scores the broken page near zero with the expected findings', () => {
    const html = loadFixture('broken.html');
    const result = structuredDataAnalyzer(makeInput({ renderedHtml: html }));
    expect(result.score).toBeLessThan(20);
    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain(SD_FINDINGS.MISSING_JSON_LD);
    expect(ids).toContain(SD_FINDINGS.MISSING_OG_TAGS);
    expect(ids).toContain(SD_FINDINGS.MISSING_CANONICAL);
  });

  it('detects invalid JSON-LD and flags it as high severity', () => {
    const html = `<!doctype html><html lang="en"><head>
      <title>Test page with invalid JSON-LD</title>
      <script type="application/ld+json">{ "@context": "https://schema.org", "@type": }</script>
    </head><body><h1>Test</h1></body></html>`;
    const result = structuredDataAnalyzer(makeInput({ renderedHtml: html }));
    const f = result.findings.find((x) => x.id === SD_FINDINGS.INVALID_JSON_LD);
    expect(f).toBeDefined();
    expect(f?.severity).toBe('high');
  });

  it('credits a product page with microdata + JSON-LD + canonical', () => {
    const html = loadFixture('ecommerce-product.html');
    const result = structuredDataAnalyzer(makeInput({ renderedHtml: html }));
    expect(result.score).toBeGreaterThan(80);
    expect((result.metrics as { microdataCount: number }).microdataCount).toBeGreaterThan(0);
  });

  it('credits a blog article without microdata when JSON-LD covers it', () => {
    const html = loadFixture('blog-article.html');
    const result = structuredDataAnalyzer(makeInput({ renderedHtml: html }));
    expect(result.score).toBeGreaterThan(70);
    expect((result.metrics as { jsonLdTypes: string[] }).jsonLdTypes).toContain('Article');
  });

  it('penalizes a thin marketing page that has only title + meta description', () => {
    const html = loadFixture('marketing-thin.html');
    const result = structuredDataAnalyzer(makeInput({ renderedHtml: html }));
    expect(result.score).toBeLessThan(40);
  });

  it('produces a stable snapshot for the ideal fixture', () => {
    const html = loadFixture('ideal.html');
    const result = structuredDataAnalyzer(makeInput({ renderedHtml: html }));
    expect({
      score: result.score,
      findingIds: result.findings.map((f) => f.id).sort(),
    }).toMatchSnapshot();
  });
});
