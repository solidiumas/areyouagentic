import Anthropic from '@anthropic-ai/sdk';
import { env } from './env.js';

/**
 * Public output of the LLM step. verdict is a one-sentence summary; quickWins
 * are the 2-3 highest-leverage fixes the user can ship in one sitting.
 */
export type LlmInsight = {
  verdict: string;
  quickWins: string[];
};

let clientCache: Anthropic | null = null;

function client(): Anthropic {
  if (clientCache) return clientCache;
  clientCache = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return clientCache;
}

export function llmConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

/**
 * Big, opinionated, version-stable instruction block. The text never changes
 * between runs, so we mark it cache_control: ephemeral and the Anthropic API
 * returns the same content as a cache hit on every subsequent request — 90 %
 * input-token cost reduction for the slow-changing portion.
 *
 * Bump SYSTEM_PROMPT_VERSION whenever this text changes so cache analytics
 * stay honest.
 */
export const SYSTEM_PROMPT_VERSION = '2026.06.07.1';

const SYSTEM_PROMPT = `You are the senior reviewer for areyouagentic.com, a service that grades a webpage on how well AI agents and LLMs can read, understand, and act on it.

You receive a JSON payload describing one analysis. Your job is to produce a short, opinionated, human-readable summary on top of the deterministic scores. You speak directly to the site's owner.

Output JSON only, matching this shape exactly:
{
  "verdict": "one sentence, max 200 chars, no hype, plain English",
  "quickWins": ["fix 1", "fix 2", "fix 3"]
}

Rules:
- "verdict" is one declarative sentence. It must reflect the overall grade — celebrate an A, name the gap on a D/F, and don't sugarcoat. Never start with "Your site...".
- "quickWins" is 2–3 items. Each is a concrete, copy-pasteable fix the owner can ship in one sitting (≤ 30 minutes of work). No vague platitudes ("improve performance"). Prefer high-severity findings; never suggest something the data shows is already done.
- Use the dimension scores and findings to prioritise. If "agentSignals" is below 30 and there is no llms.txt, that's almost always a top quickWin.
- Total output ≤ 600 characters. Be terse.
- Output JSON ONLY — no markdown fence, no preamble, no trailing commentary.`;

type AnalyzerSummary = {
  dimensionScores: Record<string, number>;
  overall: number;
  grade: string;
  pageTitle: string | null;
  finalUrl: string;
  topFindings: { id: string; severity: string; title: string }[];
  hasRobotsTxt: boolean;
  hasLlmsTxt: boolean;
  hasSitemap: boolean;
};

/**
 * Call Claude Haiku 4.5 for a verdict + quick wins.
 *
 * Behaviour:
 *   - Returns null and never throws if ANTHROPIC_API_KEY is absent — callers
 *     should treat that as "skip the LLM step", not an error.
 *   - On API failure (rate limit, network, malformed response), logs at warn
 *     and returns null. The analyzers' deterministic output is the source of
 *     truth; the LLM is decoration.
 *   - Uses cache_control on the system block so repeat calls within the
 *     5-minute cache window pay ~10 % of the system tokens.
 */
export async function llmAnalyze(
  summary: AnalyzerSummary,
  log: { warn: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void },
): Promise<LlmInsight | null> {
  if (!llmConfigured()) return null;

  try {
    const response = await client().messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Analyse summary:\n${JSON.stringify(summary, null, 2)}`,
        },
      ],
    });

    const usage = response.usage;
    log.info(
      {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
        promptVersion: SYSTEM_PROMPT_VERSION,
      },
      'llm call complete',
    );

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');

    return parseLlmJson(text);
  } catch (err) {
    log.warn({ err }, 'llm call failed — falling back to no narrative');
    return null;
  }
}

/**
 * Tolerant parser. Claude is fast and consistent at Haiku, but accept a leading
 * code-fence or stray whitespace just in case. Returns null on anything we
 * can't trust.
 */
function parseLlmJson(raw: string): LlmInsight | null {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).verdict !== 'string' ||
    !Array.isArray((parsed as Record<string, unknown>).quickWins)
  ) {
    return null;
  }
  const obj = parsed as { verdict: string; quickWins: unknown[] };
  if (!obj.quickWins.every((w): w is string => typeof w === 'string')) return null;
  const verdict = obj.verdict.trim();
  const quickWins = obj.quickWins.map((w) => w.trim()).filter((w) => w.length > 0);
  if (verdict.length === 0 || quickWins.length === 0) return null;
  return { verdict, quickWins };
}
