import type { Logger } from 'pino';

/**
 * Shape that flows through the pipeline. Each stage takes the context, does
 * its work, and returns it (typically with new fields filled in). Optional
 * fields are populated incrementally — `findings` and `scores` accumulate.
 */
export type AnalysisContext = {
  url: string;
  jobId: string;

  rawHtml?: string;
  renderedHtml?: string;
  /** Path or buffer reference to the page screenshot (R2 key, eventually). */
  screenshot?: string;

  robotsTxt?: string | null;
  llmsTxt?: string | null;
  sitemapXml?: string | null;

  findings: Record<string, unknown>;
  scores?: {
    overall: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    machineReadability: number;
    structuredData: number;
    agentSignals: number;
    actionability: number;
    performance: number;
    contentClarity: number;
  };

  /** Per-job logger pre-tagged with jobId/url. */
  log: Logger;
};

export type Stage = (ctx: AnalysisContext) => Promise<AnalysisContext>;

/**
 * Marker error class for failures we should NOT retry — invalid URL after
 * redirects, 404, robots.txt disallow, etc. BullMQ checks for this in the
 * worker's failure handler.
 */
export class PermanentJobError extends Error {
  override readonly name = 'PermanentJobError';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}
