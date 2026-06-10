import type { Logger } from 'pino';
import type { PerformanceMetrics } from '@areyouagentic/analyzers';
import type { LlmInsight } from '../lib/llm.js';

/**
 * Shape that flows through the pipeline. Each stage takes the context, does
 * its work, and returns it (typically with new fields filled in). Optional
 * fields are populated incrementally — `findings` and `scores` accumulate.
 */
export type AnalysisContext = {
  url: string;
  jobId: string;

  /** URL after redirects — set by fetch stage. */
  finalUrl?: string;
  /** Document <title> — set by fetch stage from rawHtml. */
  pageTitle?: string;

  rawHtml?: string;
  renderedHtml?: string;
  /** Render-stage timings + page weight. */
  performanceMetrics?: PerformanceMetrics;
  /** PNG screenshot bytes — set by render stage, uploaded by persist stage. */
  screenshotBytes?: Buffer;
  /** Public R2 URL of the uploaded screenshot — set by persist stage. */
  screenshot?: string;

  robotsTxt?: string | null;
  llmsTxt?: string | null;
  sitemapXml?: string | null;

  findings: Record<string, unknown>;
  /** LLM verdict + quick-wins. Null when no Anthropic key is configured. */
  llmInsight?: LlmInsight | null;
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
