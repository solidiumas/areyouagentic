import { describe, expect, it } from 'vitest';
import {
  AS_FINDINGS,
  agentSignalsAnalyzer,
  botIsAllowed,
  parseRobotsTxt,
} from '../src/agentSignals.js';
import { loadFixture, makeInput } from './helpers.js';

describe('agentSignalsAnalyzer', () => {
  it('scores the ideal fixture (https + friendly robots + good llms.txt + sitemap) near full', () => {
    const result = agentSignalsAnalyzer(
      makeInput({
        renderedHtml: loadFixture('ideal.html'),
        robotsTxt: loadFixture('robots-friendly.txt'),
        llmsTxt: loadFixture('llms-good.txt'),
        sitemapXml: loadFixture('sitemap-good.xml'),
        finalUrl: 'https://acme.coffee/',
      }),
    );
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.findings).toEqual([]);
  });

  it('scores zero-ish when nothing is present and the site is plain HTTP', () => {
    const result = agentSignalsAnalyzer(
      makeInput({
        renderedHtml: '<html><body></body></html>',
        finalUrl: 'http://example.com/',
      }),
    );
    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain(AS_FINDINGS.NO_ROBOTS_TXT);
    expect(ids).toContain(AS_FINDINGS.NO_LLMS_TXT);
    expect(ids).toContain(AS_FINDINGS.NO_SITEMAP);
    expect(ids).toContain(AS_FINDINGS.NOT_HTTPS);
    expect(result.score).toBeLessThan(15);
  });

  it('flags fully-blocked AI bots', () => {
    const result = agentSignalsAnalyzer(
      makeInput({
        renderedHtml: '<html><body></body></html>',
        robotsTxt: loadFixture('robots-blocks-ai.txt'),
        finalUrl: 'https://example.com/',
      }),
    );
    expect(result.findings.map((f) => f.id)).toContain(AS_FINDINGS.ROBOTS_BLOCKS_AI);
    expect((result.metrics as { aiBotsAllowed: string[] }).aiBotsAllowed).toEqual([]);
  });

  it('flags partially-blocked AI bots', () => {
    const result = agentSignalsAnalyzer(
      makeInput({
        renderedHtml: '<html><body></body></html>',
        robotsTxt: loadFixture('robots-partial.txt'),
        finalUrl: 'https://example.com/',
      }),
    );
    expect(result.findings.map((f) => f.id)).toContain(AS_FINDINGS.ROBOTS_PARTIAL_AI);
    const blocked = (result.metrics as { aiBotsBlocked: string[] }).aiBotsBlocked;
    expect(blocked).toContain('GPTBot');
    expect(blocked).toContain('CCBot');
  });

  it('flags an llms.txt that does not follow the standard', () => {
    const result = agentSignalsAnalyzer(
      makeInput({
        renderedHtml: '<html><body></body></html>',
        robotsTxt: loadFixture('robots-friendly.txt'),
        llmsTxt: loadFixture('llms-malformed.txt'),
        sitemapXml: loadFixture('sitemap-good.xml'),
        finalUrl: 'https://example.com/',
      }),
    );
    expect(result.findings.map((f) => f.id)).toContain(AS_FINDINGS.LLMS_TXT_INVALID);
  });

  it('flags an invalid sitemap', () => {
    const result = agentSignalsAnalyzer(
      makeInput({
        renderedHtml: '<html><body></body></html>',
        sitemapXml: loadFixture('sitemap-broken.xml'),
        finalUrl: 'https://example.com/',
      }),
    );
    expect(result.findings.map((f) => f.id)).toContain(AS_FINDINGS.INVALID_SITEMAP);
  });

  it('parseRobotsTxt: handles stacked User-agent groups', () => {
    const text = `User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n`;
    const parsed = parseRobotsTxt(text);
    expect(botIsAllowed(parsed, 'GPTBot')).toBe(false);
    expect(botIsAllowed(parsed, 'ClaudeBot')).toBe(false);
    expect(botIsAllowed(parsed, 'Bytespider')).toBe(true);
  });

  it('parseRobotsTxt: empty Disallow means allow', () => {
    const text = `User-agent: *\nDisallow:\n`;
    const parsed = parseRobotsTxt(text);
    expect(botIsAllowed(parsed, 'GPTBot')).toBe(true);
  });

  it('produces a stable snapshot for the ideal scenario', () => {
    const result = agentSignalsAnalyzer(
      makeInput({
        renderedHtml: loadFixture('ideal.html'),
        robotsTxt: loadFixture('robots-friendly.txt'),
        llmsTxt: loadFixture('llms-good.txt'),
        sitemapXml: loadFixture('sitemap-good.xml'),
        finalUrl: 'https://acme.coffee/',
      }),
    );
    expect({
      score: result.score,
      findingIds: result.findings.map((f) => f.id).sort(),
    }).toMatchSnapshot();
  });
});
