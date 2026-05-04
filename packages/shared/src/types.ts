/**
 * Tagged success/failure pair. Use this instead of throwing for predictable
 * error paths (validation, parsing, network probes) where the caller is
 * expected to react to the failure.
 */
export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// Inferred types from Zod schemas live next to their schemas (e.g. `Finding`
// next to `findingSchema` in `findings.ts`) and are re-exported from the
// package root via `index.ts`. Co-locating them keeps the schema and type in
// sync and avoids `export *` ambiguity in the barrel.
//
// To get a type, import from the package root:
//
//   import type { Finding, ReportData, AnalyzeRequest } from '@areyouagentic/shared';
