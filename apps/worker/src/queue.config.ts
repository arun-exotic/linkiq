import { ConnectionOptions, JobsOptions } from 'bullmq';
import { QUEUES } from '@app/queue';

export const CONCURRENCY = {
  CLICK_EVENTS: 5,
  CLEANUP: 1,
} as const;

export const QUEUE_DEFAULTS: Record<
  string,
  { defaultJobOptions: JobsOptions }
> = {
  [QUEUES.CLICK_EVENTS]: {
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  },
  [QUEUES.CLEANUP]: {
    defaultJobOptions: {
      attempts: 3,
      removeOnComplete: 10,
      removeOnFail: 50,
    },
  },
};

export function getQueueConnection(): ConnectionOptions {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  };
}

export const CLEANUP_SCHEDULE = {
  EXPIRED_SLUGS: { pattern: '0 2 * * *', jobId: 'cleanup-expired-slugs' },
  REFRESH_TOKENS: { pattern: '0 3 * * *', jobId: 'cleanup-refresh-tokens' },
} as const;
