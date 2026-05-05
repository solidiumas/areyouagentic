import * as cheerio from 'cheerio';

export type CheerioRoot = cheerio.CheerioAPI;

// Minimal structural types for the DOM nodes cheerio returns. We don't import
// from `domhandler` directly because pnpm hides it as a transitive dep, and
// we only need a tiny surface (type + data/name/children) for tree walking.
type Text = { type: 'text'; data: string };
type Element = { type: 'tag'; name: string; children?: AnyNode[] };
type AnyNode = Text | Element | { type: string; children?: AnyNode[] };

const NON_RENDERED_TAGS = new Set(['script', 'style', 'noscript', 'template']);

/** Parse HTML into a cheerio root. Wrapper exists so analyzers can stay decoupled from the parser. */
export function loadHtml(html: string): CheerioRoot {
  return cheerio.load(html);
}

export function isElement(node: AnyNode | null | undefined): node is Element {
  return !!node && node.type === 'tag';
}

export function isTextNode(node: AnyNode | null | undefined): node is Text {
  return !!node && node.type === 'text';
}

/**
 * Extracts visible text by walking the DOM and skipping nodes that don't
 * paint (`script`, `style`, `noscript`, `template`). Whitespace is collapsed
 * to a single space so caller-side comparisons are stable across formatters.
 */
export function getVisibleText($: CheerioRoot): string {
  const out: string[] = [];
  walkText($, $.root().get(0) as unknown as AnyNode | undefined, out);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * All non-empty text nodes in document order. Used by the raw-vs-rendered
 * comparator — matching at the node level is more precise than substring
 * search on a single concatenated string.
 */
export function getTextNodes($: CheerioRoot): string[] {
  const out: string[] = [];
  walkText($, $.root().get(0) as unknown as AnyNode | undefined, out);
  return out;
}

function walkText($: CheerioRoot, node: AnyNode | undefined, out: string[]): void {
  if (!node) return;
  if (isTextNode(node)) {
    const trimmed = String(node.data ?? '').trim();
    if (trimmed.length > 0) out.push(trimmed);
    return;
  }
  if (isElement(node)) {
    const tag = node.name.toLowerCase();
    if (NON_RENDERED_TAGS.has(tag)) return;
    if (tag === 'iframe') return;
  }
  const children = (node as { children?: AnyNode[] }).children;
  if (!children) return;
  for (const child of children) walkText($, child, out);
}

/** Count occurrences of each tag, returned as `{ [tag]: count }`. */
export function countTags($: CheerioRoot, tags: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tag of tags) {
    counts[tag] = $(tag).length;
  }
  return counts;
}

/**
 * Truncate an arbitrary value into a short string suitable for embedding in
 * a Finding's `evidence` field. Keeps payloads bounded so a giant DOM dump
 * doesn't blow up the report row.
 */
export function snippet(value: unknown, max = 200): string {
  let s: string;
  if (typeof value === 'string') s = value;
  else {
    try {
      s = JSON.stringify(value);
    } catch {
      s = String(value);
    }
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Linear interpolation between two thresholds, clamped to [0, max].
 *  - value <= goodAt → returns max
 *  - value >= badAt → returns 0
 *  - otherwise interpolates linearly
 *
 * Direction-aware: if `badAt > goodAt` (lower is better, e.g. TTFB) the
 * scale flips automatically.
 */
export function linearScore(value: number, goodAt: number, badAt: number, max: number): number {
  if (goodAt === badAt) return value <= goodAt ? max : 0;
  const lowerBetter = badAt > goodAt;
  if (lowerBetter) {
    if (value <= goodAt) return max;
    if (value >= badAt) return 0;
    return Math.round(((badAt - value) / (badAt - goodAt)) * max);
  }
  if (value >= goodAt) return max;
  if (value <= badAt) return 0;
  return Math.round(((value - badAt) / (goodAt - badAt)) * max);
}

/** Clamp + round a numeric score to a 0-100 integer. */
export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
