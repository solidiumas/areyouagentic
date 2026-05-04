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
