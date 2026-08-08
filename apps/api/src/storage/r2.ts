import * as fs from 'fs';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    if (!config.r2.endpoint || !config.r2.accessKeyId || !config.r2.secretAccessKey || !config.r2.bucket) {
      throw new Error('R2 storage is not configured (R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET)');
    }
    client = new S3Client({
      region: 'auto',
      endpoint: config.r2.endpoint,
      credentials: {
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
      },
    });
  }
  return client;
}

/**
 * Upload a local file to R2 under `key`. The bucket is kept private — the
 * DB only stores this key (see jobs.result_key), and callers get a
 * time-limited presigned URL via `getDownloadUrl` generated fresh at read
 * time, so it can't go stale between job completion and someone checking
 * job status hours/days later.
 */
export async function uploadResultFile(localFilePath: string, key: string): Promise<void> {
  const s3 = getClient();
  const body = fs.createReadStream(localFilePath);

  await s3.send(
    new PutObjectCommand({
      Bucket: config.r2.bucket,
      Key: key,
      Body: body,
      ContentType: 'audio/mpeg',
    })
  );
}

export async function getDownloadUrl(key: string): Promise<string> {
  const s3 = getClient();
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: config.r2.bucket, Key: key }), {
    expiresIn: config.downloadUrlTtlSeconds,
  });
}
