import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnalysisInput, PerformanceMetrics } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(here, 'fixtures');

export function loadFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf-8');
}

const DEFAULT_METRICS: PerformanceMetrics = {
  ttfb: 200,
  pageSize: 500_000,
  numRequests: 30,
  domContentLoaded: 1500,
  networkIdle: 3000,
};

/**
 * Build an `AnalysisInput` with safe defaults so each test only specifies
 * the fields it cares about. `rawHtml` defaults to `renderedHtml` (i.e. SSR);
 * tests that need a SPA-style mismatch override `rawHtml` explicitly.
 */
export function makeInput(
  overrides: Partial<AnalysisInput> & { renderedHtml: string },
): AnalysisInput {
  return {
    url: overrides.url ?? 'https://example.com/',
    finalUrl: overrides.finalUrl ?? 'https://example.com/',
    rawHtml: overrides.rawHtml ?? overrides.renderedHtml,
    renderedHtml: overrides.renderedHtml,
    robotsTxt: overrides.robotsTxt ?? null,
    llmsTxt: overrides.llmsTxt ?? null,
    sitemapXml: overrides.sitemapXml ?? null,
    performanceMetrics: overrides.performanceMetrics ?? DEFAULT_METRICS,
  };
}
