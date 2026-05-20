import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

export async function uploadScreenshot(
  key: string,
  bytes: Buffer,
): Promise<R2UploadResult> {
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
