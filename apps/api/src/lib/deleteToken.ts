import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * One-time, capability-style delete tokens for reports.
 *
 * The submitter receives the plaintext token once (in the analyze response);
 * we persist only its SHA-256 hash. Deleting a report requires presenting the
 * plaintext, so possession of the public report link alone is not enough — only
 * whoever submitted the analysis can delete it, no account required.
 */

/** 32 bytes of CSPRNG entropy, URL-safe so it can live in a header or link. */
export function createDeleteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashDeleteToken(token) };
}

export function hashDeleteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison of a presented token against a stored hash. Returns
 * false (never throws) for a missing/empty stored hash or any length mismatch.
 */
export function verifyDeleteToken(token: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const presented = Buffer.from(hashDeleteToken(token), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (presented.length !== stored.length || presented.length === 0) return false;
  return timingSafeEqual(presented, stored);
}
