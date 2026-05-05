import { describe, expect, it } from 'vitest';
import { AC_FINDINGS, actionabilityAnalyzer } from '../src/actionability.js';
import { loadFixture, makeInput } from './helpers.js';

describe('actionabilityAnalyzer', () => {
  it('scores the ideal page near the top', () => {
    const result = actionabilityAnalyzer(
      makeInput({
        renderedHtml: loadFixture('ideal.html'),
        finalUrl: 'https://acme.coffee/',
      }),
    );
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('scores the broken page very low and surfaces the right findings', () => {
    const result = actionabilityAnalyzer(
      makeInput({
        renderedHtml: loadFixture('broken.html'),
        finalUrl: 'https://example.com/',
      }),
    );
    expect(result.score).toBeLessThan(35);
    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain(AC_FINDINGS.INPUTS_MISSING_LABEL);
    expect(ids).toContain(AC_FINDINGS.CLICKABLE_DIV_INSTEAD_OF_BUTTON);
    expect(ids).toContain(AC_FINDINGS.IMAGES_MISSING_ALT);
  });

  it('flags non-readable URLs (uppercase, session ids, hex tokens)', () => {
    const cases = [
      'https://example.com/Path/With/Caps',
      'https://example.com/page?sid=abc123',
      'https://example.com/' + 'a'.repeat(48),
    ];
    for (const url of cases) {
      const result = actionabilityAnalyzer(
        makeInput({
          renderedHtml: '<html><body><h1>Hi</h1></body></html>',
          finalUrl: url,
        }),
      );
      expect(result.findings.map((f) => f.id)).toContain(AC_FINDINGS.NON_READABLE_URL);
    }
  });

  it('credits a product page with labeled inputs and stable ids', () => {
    const result = actionabilityAnalyzer(
      makeInput({
        renderedHtml: loadFixture('ecommerce-product.html'),
        finalUrl: 'https://northwind.example.com/products/wool-beanie-grey',
      }),
    );
    expect(result.score).toBeGreaterThan(70);
    const ids = result.findings.map((f) => f.id);
    expect(ids).not.toContain(AC_FINDINGS.INPUTS_MISSING_LABEL);
  });

  it('flags weak link text when several links use generic phrasing', () => {
    const html = `<!doctype html><html lang="en"><body>
      <a href="/a">click here</a>
      <a href="/b">read more</a>
      <a href="/c">learn more</a>
      <a href="/d">more</a>
    </body></html>`;
    const result = actionabilityAnalyzer(makeInput({ renderedHtml: html, finalUrl: 'https://example.com/' }));
    expect(result.findings.map((f) => f.id)).toContain(AC_FINDINGS.WEAK_LINK_TEXT);
  });

  it('rates a blog article (no forms, has alt text) above marketing-thin', () => {
    const blog = actionabilityAnalyzer(
      makeInput({
        renderedHtml: loadFixture('blog-article.html'),
        finalUrl: 'https://loaf.example.com/posts/sourdough-hydration',
      }),
    );
    const thin = actionabilityAnalyzer(
      makeInput({
        renderedHtml: loadFixture('marketing-thin.html'),
        finalUrl: 'https://example.com/',
      }),
    );
    expect(blog.score).toBeGreaterThan(thin.score);
  });

  it('produces a stable snapshot for the ideal fixture', () => {
    const result = actionabilityAnalyzer(
      makeInput({
        renderedHtml: loadFixture('ideal.html'),
        finalUrl: 'https://acme.coffee/',
      }),
    );
    expect({ score: result.score, findingIds: result.findings.map((f) => f.id).sort() }).toMatchSnapshot();
  });
});
