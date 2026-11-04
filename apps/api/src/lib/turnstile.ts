import { env } from './env.js';

/**
 * Cloudflare Turnstile verification — an optional bot gate on POST /api/analyze.
 *
 * Enforced only when `TURNSTILE_SECRET_KEY` is configured; otherwise every call
 * passes so local dev / CI / curl keep working. When enforced, verification
 * fails closed (a missing/invalid token or an unreachable Cloudflare both deny
 * the request) — operators can always disable the gate by unsetting the key.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function turnstileEnabled(): boolean {
  return Boolean(env.TURNSTILE_SECRET_KEY);
}

/**
 * Low-level siteverify call. Pure with respect to env (takes the secret as an
 * argument) so it can be unit-tested without booting the env. Returns true only
 * on an explicit `{ success: true }` from Cloudflare.
 */
export async function siteverify(
  secret: string,
  token: string,
  remoteIp?: string,
  /** When set, a successful token is also required to have been solved on
   * this hostname (Cloudflare echoes it back). */
  expectedHostname?: string,
): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean; hostname?: string };
    if (data.success !== true) return false;
    // Bind the token to OUR site: siteverify reports which hostname the
    // challenge was solved on, so a token minted on another site (shared or
    // leaked sitekey) doesn't pass here.
    if (expectedHostname && data.hostname && data.hostname !== expectedHostname) return false;
    return true;
  } catch {
    // Network error / timeout → fail closed while the gate is enabled.
    return false;
  }
}

/**
 * Verify a request's Turnstile token. Returns true (allow) when the gate is
 * disabled; otherwise delegates to {@link siteverify}.
 */
export async function verifyTurnstileToken(token: string, remoteIp?: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  return siteverify(env.TURNSTILE_SECRET_KEY, token, remoteIp, new URL(env.APP_URL).hostname);
}
