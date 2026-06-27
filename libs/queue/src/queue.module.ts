import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from './queue.constants';
import { QueueService } from './queue.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.CLICK_EVENTS })],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
