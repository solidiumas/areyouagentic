import { describe, expect, it } from 'vitest';
import { CC_FINDINGS, contentClarityAnalyzer, fleschReadingEase } from '../src/contentClarity.js';
import { loadFixture, makeInput } from './helpers.js';

describe('contentClarityAnalyzer', () => {
  it('scores the ideal page near the top', () => {
    const result = contentClarityAnalyzer(makeInput({ renderedHtml: loadFixture('ideal.html') }));
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect((result.metrics as { titleLength: number }).titleLength).toBeGreaterThan(20);
  });

  it('scores the broken page near zero', () => {
    const result = contentClarityAnalyzer(makeInput({ renderedHtml: loadFixture('broken.html') }));
    expect(result.score).toBeLessThan(25);
    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain(CC_FINDINGS.TITLE_MISSING);
    expect(ids).toContain(CC_FINDINGS.META_DESC_MISSING);
    expect(ids).toContain(CC_FINDINGS.H1_MISSING);
  });

  it('flags a too-short title and too-short meta description on the marketing-thin fixture', () => {
    const result = contentClarityAnalyzer(
      makeInput({ renderedHtml: loadFixture('marketing-thin.html') }),
    );
    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain(CC_FINDINGS.TITLE_TOO_SHORT);
    expect(ids).toContain(CC_FINDINGS.META_DESC_TOO_SHORT);
    expect(ids).toContain(CC_FINDINGS.THIN_CONTENT);
  });

  it('credits a substantial blog article with high word count and decent readability', () => {
    const result = contentClarityAnalyzer(
      makeInput({ renderedHtml: loadFixture('blog-article.html') }),
    );
    expect(result.score).toBeGreaterThan(70);
    const m = result.metrics as { mainWordCount: number; flesch: number };
    expect(m.mainWordCount).toBeGreaterThan(150);
    expect(m.flesch).toBeGreaterThan(30);
  });

  it('flags a too-long title', () => {
    const html = `<!doctype html><html lang="en"><head>
      <title>${'A really long title that goes well past seventy characters and should be flagged for being too long'}</title>
      <meta name="description" content="${'b'.repeat(80)}" />
    </head><body><main><h1>Title</h1><p>${'word '.repeat(200)}</p></main></body></html>`;
    const result = contentClarityAnalyzer(makeInput({ renderedHtml: html }));
    expect(result.findings.map((f) => f.id)).toContain(CC_FINDINGS.TITLE_TOO_LONG);
  });

  it('flags h1/title mismatch when topics disagree', () => {
    const html = `<!doctype html><html lang="en"><head>
      <title>Sourdough hydration changes the crumb structure of artisan bread</title>
      <meta name="description" content="${'about bread baking '.repeat(5)}" />
    </head><body><main><h1>Quarterly revenue results for fiscal year 2024</h1><p>${'word '.repeat(200)}</p></main></body></html>`;
    const result = contentClarityAnalyzer(makeInput({ renderedHtml: html }));
    expect(result.findings.map((f) => f.id)).toContain(CC_FINDINGS.H1_TITLE_MISMATCH);
  });

  it('fleschReadingEase returns 0 for very short text and a sensible value otherwise', () => {
    expect(fleschReadingEase('Too short.')).toBe(0);
    const easy =
      'The cat sat on the mat. The dog ran in the park. The sun was warm. The kids played all day. Lunch was ready at noon. They ate and went home.';
    const easyScore = fleschReadingEase(easy.repeat(2));
    expect(easyScore).toBeGreaterThan(50);
  });

  it('produces a stable snapshot for the ideal fixture', () => {
    const result = contentClarityAnalyzer(makeInput({ renderedHtml: loadFixture('ideal.html') }));
    expect({
      score: result.score,
      findingIds: result.findings.map((f) => f.id).sort(),
    }).toMatchSnapshot();
  });
});
