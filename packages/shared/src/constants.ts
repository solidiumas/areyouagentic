import type { Dimension, Grade } from './dimensions.js';

/**
 * Per-dimension weights used to compute the overall score. Must sum to 1.0.
 * Tweak with care — changing weights re-grades every historical report when
 * scores are recomputed.
 */
export const SCORE_WEIGHTS: Readonly<Record<Dimension, number>> = Object.freeze({
  machineReadability: 0.25,
  structuredData: 0.2,
  agentSignals: 0.15,
  actionability: 0.2,
  performance: 0.1,
  contentClarity: 0.1,
});

// Sanity check: the weights must sum to 1 (within floating-point tolerance).
// Kept as a runtime assertion so a bad edit fails loudly at module load.
{
  const sum = Object.values(SCORE_WEIGHTS).reduce((acc, w) => acc + w, 0);
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`SCORE_WEIGHTS must sum to 1.0, got ${sum}`);
  }
}

/**
 * Lower bound (inclusive) for each grade. A score of 90 → 'A', 89 → 'B',
 * 75 → 'B', 74 → 'C', etc. Anything below 40 falls through to 'F'.
 */
export const GRADE_THRESHOLDS: Readonly<Record<Exclude<Grade, 'F'>, number>> = Object.freeze({
  A: 90,
  B: 75,
  C: 60,
  D: 40,
});

/**
 * User-Agent the worker presents when fetching analysis targets. Includes a
 * URL so site owners can identify and contact us if needed — this is required
 * by good-citizen crawler etiquette and helps avoid getting blocklisted.
 */
export const USER_AGENT = 'AreYouAgenticBot/1.0 (+https://areyouagentic.com/bot)';

/**
 * Network and analysis timeouts, all in milliseconds. Single source of truth
 * so api/worker/web stay aligned.
 */
export const TIMEOUTS = Object.freeze({
  /** Hard cap on a single HTTP fetch (DNS + connect + response). */
  fetch: 15_000,
  /** Time we allow a headless browser to render the page. */
  render: 30_000,
  /** Wall-clock cap on a full analysis job before it's marked FAILED. */
  job: 120_000,
  /** robots.txt / sitemap probes are small; keep them snappy. */
  probe: 5_000,
  /** API request → worker queue handoff. */
  enqueue: 2_000,
});
export type Timeouts = typeof TIMEOUTS;
