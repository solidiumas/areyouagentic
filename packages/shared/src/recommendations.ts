import { z } from 'zod';
import { dimensionSchema } from './dimensions.js';

export const recommendationPrioritySchema = z.enum(['low', 'medium', 'high']);
export type RecommendationPriority = z.infer<typeof recommendationPrioritySchema>;

/**
 * A category bucket aligned with the six analyzer dimensions. Reuses
 * `dimensionSchema` so adding a new dimension automatically broadens the
 * recommendation type.
 */
export const recommendationCategorySchema = dimensionSchema;
export type RecommendationCategory = z.infer<typeof recommendationCategorySchema>;

export const recommendationSchema = z.object({
  priority: recommendationPrioritySchema,
  category: recommendationCategorySchema,
  title: z.string().min(1),
  description: z.string(),
  /** Copy-pasteable HTML / header / JSON-LD snippet that fixes the issue. */
  exampleCode: z.string().optional(),
});
export type Recommendation = z.infer<typeof recommendationSchema>;

export const recommendationsSchema = z.array(recommendationSchema);
export type Recommendations = z.infer<typeof recommendationsSchema>;
