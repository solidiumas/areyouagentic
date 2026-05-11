import type { Finding } from '@areyouagentic/shared';

/**
 * Performance metrics captured by the render stage and passed in by the
 * orchestrator. Analyzers never make network calls — all values come from
 * upstream observation, so the units stay consistent across runs.
 */
export type PerformanceMetrics = {
  /** Time-to-first-byte, milliseconds. */
  ttfb: number;
  /** Total transferred page weight, bytes. */
  pageSize: number;
  /** Number of network requests issued during render. */
  numRequests: number;
  /** Time to DOMContentLoaded, milliseconds. */
  domContentLoaded: number;
  /** Time to network-idle quiescence, milliseconds. */
  networkIdle: number;
};

/**
 * Frozen snapshot of one URL plus the auxiliary documents fetched alongside
 * it. Every analyzer takes the same shape so the orchestrator can fan them
 * out as `Promise.all(analyzers.map(a => a(input)))`.
 */
export type AnalysisInput = {
  /** The URL the user submitted. */
  url: string;
  /** The URL after redirects (the actual document we analyzed). */
  finalUrl: string;
  /** HTML as returned by the server, before client-side scripts ran. */
  rawHtml: string;
  /** HTML after JS execution / hydration in the headless browser. */
  renderedHtml: string;
  /** Contents of /robots.txt or null if missing/unreachable. */
  robotsTxt: string | null;
  /** Contents of /llms.txt or null if missing. */
  llmsTxt: string | null;
  /** Contents of the discovered sitemap.xml or null. */
  sitemapXml: string | null;
  /** Render-stage timings + page weight. */
  performanceMetrics: PerformanceMetrics;
};

/**
 * Common analyzer output. `score` is a 0-100 sub-score for one dimension;
 * `findings` are the structured checks that produced it; `metrics` is raw
 * data that gets surfaced in the report (counts, ratios, sample elements).
 */
export type AnalyzerResult = {
  /** Integer 0-100. Each analyzer documents how this is computed. */
  score: number;
  /** Stable-ID findings, suitable for rendering in the UI. */
  findings: Finding[];
  /** Raw measurements that don't fit a `Finding` — surfaced in the report. */
  metrics: Record<string, unknown>;
};

export type Analyzer = (input: AnalysisInput) => AnalyzerResult;
