/**
 * Race a promise against a deadline. The BullMQ/ioredis connections use
 * `maxRetriesPerRequest: null` (required for blocking queue commands), which
 * means a call against a down Redis queues forever instead of throwing — so
 * the fast-fail paths (503 on enqueue, 503 on /health) would hang without an
 * explicit ceiling. Prisma calls can stall the same way while the driver
 * retries a dead connection.
 *
 * Note: losing the race does NOT cancel the underlying operation — it may
 * still complete later. Callers must tolerate that (both current call sites
 * do: a late enqueue is deduped by jobId, a late health ping is discarded).
 */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
