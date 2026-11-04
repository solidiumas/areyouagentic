/**
 * Word-level Jaccard similarity between two strings, 0–1. Tokens are
 * lowercased alphanumeric words longer than 2 chars, so stop-word noise
 * ("a", "of") doesn't inflate the overlap.
 *
 * Empty-set semantics: two strings that both tokenize to nothing are
 * trivially identical → 1. One-sided emptiness shares nothing → 0.
 * (Previously two private copies of this helper disagreed on exactly this
 * case — keep the semantics here, in one place.)
 */
export function jaccardWords(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  const A = tok(a);
  const B = tok(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}
