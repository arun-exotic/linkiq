import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from '@app/queue';
import { QUEUE_DEFAULTS } from '../queue.config';
import { CleanupProcessor } from './cleanup.processor';
import { ClicksProcessor } from './clicks.processor';
import { ClicksService } from './clicks.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUES.CLICK_EVENTS,
      defaultJobOptions: QUEUE_DEFAULTS[QUEUES.CLICK_EVENTS].defaultJobOptions,
    }),
    BullModule.registerQueue({
      name: QUEUES.CLEANUP,
      defaultJobOptions: QUEUE_DEFAULTS[QUEUES.CLEANUP].defaultJobOptions,
    }),
  ],
  providers: [ClicksService, ClicksProcessor, CleanupProcessor],
})
export class ClicksModule {}
