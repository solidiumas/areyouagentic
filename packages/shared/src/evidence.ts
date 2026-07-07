import { z } from 'zod';

export const evidenceTypeSchema = z.enum([
  'html-snapshot',
  'screenshot',
  'response-headers',
  'robots-txt',
  'sitemap',
  'json-ld',
  'rendered-text',
  'other',
]);
export type EvidenceType = z.infer<typeof evidenceTypeSchema>;

export const evidenceItemSchema = z.object({
  id: z.string().min(1),
  type: evidenceTypeSchema,
  /** Object-storage URL (e.g. R2). Optional for inline snippets. */
  url: z.string().url().optional(),
  /** Inline snippet — useful for small artifacts that don't need R2. */
  inline: z.string().optional(),
  contentType: z.string().optional(),
  /** ISO-8601 timestamp string. */
  capturedAt: z.string().datetime(),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const evidenceSchema = z.array(evidenceItemSchema);
export type Evidence = z.infer<typeof evidenceSchema>;

/**
 * Object-storage keys always look like `screenshots/<name>.png`; the evidence
 * URL is `<R2_PUBLIC_URL>/<key>`. Matching on the pathname (rather than a
 * configured prefix) lets any service extract keys without knowing the
 * bucket's public URL — the API doesn't carry R2 config at all.
 */
const SCREENSHOT_KEY_RE = /^\/(screenshots\/[A-Za-z0-9_-]+\.png)$/;

/**
 * Extract the R2 object keys for every screenshot referenced by a report's
 * `evidence` JSONB column. Tolerant of malformed/legacy payloads: anything
 * that doesn't look like evidence yields no keys rather than throwing —
 * deletion paths must never fail because a row predates the current schema.
 */
export function extractScreenshotKeys(evidence: unknown): string[] {
  const parsed = evidenceSchema.safeParse(evidence);
  if (!parsed.success) return [];

  const keys: string[] = [];
  for (const item of parsed.data) {
    if (item.type !== 'screenshot' || !item.url) continue;
    try {
      const match = SCREENSHOT_KEY_RE.exec(new URL(item.url).pathname);
      if (match?.[1]) keys.push(match[1]);
    } catch {
      // Not a valid URL — skip.
    }
  }
  return keys;
}
