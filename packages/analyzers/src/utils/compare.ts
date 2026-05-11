import { getTextNodes, loadHtml } from './dom.js';

export type RawVsRenderedComparison = {
  rawTextChars: number;
  renderedTextChars: number;
  /** Fraction of rendered visible text characters that also appear in raw HTML. 0-1. */
  rawCoverage: number;
  /** Text nodes present in rendered but not in raw — i.e. JS-injected content. */
  jsOnlyTextNodes: string[];
};

/**
 * Compare raw vs rendered text. The metric is character-coverage: the share
 * of rendered visible text that's already present in the raw HTML. A SPA
 * that ships an empty shell typically scores near 0; a server-rendered page
 * scores near 1.
 *
 * We also surface a sample of rendered-only text nodes so the report can
 * show concrete examples ("Your hero copy is JS-only").
 */
export function compareRawVsRendered(
  rawHtml: string,
  renderedHtml: string,
): RawVsRenderedComparison {
  const $raw = loadHtml(rawHtml);
  const $rend = loadHtml(renderedHtml);

  const rawNodes = getTextNodes($raw);
  const rendNodes = getTextNodes($rend);

  const rawCharSet = new Set(rawNodes);
  const rawTextChars = rawNodes.reduce((acc, t) => acc + t.length, 0);
  const renderedTextChars = rendNodes.reduce((acc, t) => acc + t.length, 0);

  const jsOnlyTextNodes: string[] = [];
  let coveredChars = 0;
  for (const node of rendNodes) {
    if (rawCharSet.has(node)) {
      coveredChars += node.length;
    } else {
      jsOnlyTextNodes.push(node);
    }
  }

  const rawCoverage = renderedTextChars === 0 ? 1 : coveredChars / renderedTextChars;

  return {
    rawTextChars,
    renderedTextChars,
    rawCoverage,
    jsOnlyTextNodes: jsOnlyTextNodes.slice(0, 20),
  };
}
