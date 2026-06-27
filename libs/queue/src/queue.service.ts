import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Queue } from 'bullmq';

export interface ClickPayload {
  linkId: string;
  ip: string;
  userAgent?: string;
  referer?: string;
  timestamp: string;
  correlationId: string;
}

@Injectable()
export class QueueService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue('click-events') private readonly clickQueue: Queue,
    @InjectQueue('cleanup') private readonly cleanupQueue: Queue,
  ) {}

  async enqueueClick(payload: ClickPayload) {
    await this.clickQueue.add('process-click', payload, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }

  async onApplicationBootstrap() {
    try {
      await this.cleanupQueue.add(
        'cleanup-expired-slugs',
        {},
        {
          repeat: { pattern: '0 2 * * *' },
          jobId: 'cleanup-expired-slugs',
        },
      );
      await this.cleanupQueue.add(
        'cleanup-refresh-tokens',
        {},
        {
          repeat: { pattern: '0 3 * * *' },
          jobId: 'cleanup-refresh-tokens',
        },
      );
    } catch (err) {
      this.logger.error('Failed to register cleanup jobs', err);
    }
  }
}
