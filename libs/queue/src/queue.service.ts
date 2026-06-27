import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUES } from './queue.constants';

export interface ClickPayload {
  linkId: string;
  ip: string;
  userAgent?: string;
  referer?: string;
  timestamp: string;
  correlationId: string;
}

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(QUEUES.CLICK_EVENTS) private readonly clickQueue: Queue,
  ) {}

  async enqueueClick(payload: ClickPayload) {
    await this.clickQueue.add('process-click', payload, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }
}
