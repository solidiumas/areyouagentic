import { DeleteObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from './env.js';

function configured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET &&
    env.R2_PUBLIC_URL,
  );
}

let clientCache: S3Client | null = null;

function client(): S3Client {
  if (clientCache) return clientCache;
  clientCache = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return clientCache;
}

export type R2UploadResult = { url: string } | { skipped: true };

export async function uploadScreenshot(key: string, bytes: Buffer): Promise<R2UploadResult> {
  if (!configured()) return { skipped: true };
  await client().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET!,
      Key: key,
      Body: bytes,
      ContentType: 'image/png',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  return { url: `${env.R2_PUBLIC_URL!.replace(/\/$/, '')}/${key}` };
}

export function r2Configured(): boolean {
  return configured();
}

/** S3 DeleteObjects accepts at most 1000 keys per request. */
const DELETE_BATCH_SIZE = 1000;

/**
 * Delete screenshot objects. No-op when R2 isn't configured (nothing was
 * ever uploaded). Deleting a non-existent key succeeds — safe to re-run.
 * Throws on transport/auth errors so callers can decide whether the failure
 * is fatal (user-initiated delete) or just loggable (retention sweep).
 */
export async function deleteScreenshots(keys: string[]): Promise<void> {
  if (!configured() || keys.length === 0) return;
  for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
    const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
    const result = await client().send(
      new DeleteObjectsCommand({
        Bucket: env.R2_BUCKET!,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    if (result.Errors && result.Errors.length > 0) {
      const first = result.Errors[0];
      throw new Error(
        `R2 delete failed for ${result.Errors.length}/${batch.length} keys ` +
          `(first: ${first?.Key ?? '?'} — ${first?.Message ?? 'unknown error'})`,
      );
    }
  }
}
