import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { config } from '../config';

// BullMQ requires this exact option on the ioredis connection it's handed.
export const redisConnection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

export const DOWNLOADS_QUEUE_NAME = 'downloads';

export interface DownloadJobData {
  jobId: string; // our jobs.id (uuid) — not the BullMQ job id
  apiKeyId: string;
  source: 'spotify' | 'soundcloud' | 'bandcamp';
  url: string;
}

export const downloadsQueue = new Queue<DownloadJobData>(DOWNLOADS_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  },
});
