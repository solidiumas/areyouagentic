import { describe, expect, it } from 'vitest';
import { TimeoutError, withTimeout } from './withTimeout.js';

describe('withTimeout', () => {
  it('resolves with the value when the promise wins', async () => {
    await expect(withTimeout(Promise.resolve(42), 1_000, 'fast')).resolves.toBe(42);
  });

  it('rejects with the original error when the promise rejects in time', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 1_000, 'rejecting'),
    ).rejects.toThrow('boom');
  });

  it('rejects with TimeoutError when the deadline wins', async () => {
    const never = new Promise<void>(() => {});
    const err = await withTimeout(never, 10, 'stuck-dependency').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as Error).message).toBe('stuck-dependency timed out after 10ms');
  });
});
