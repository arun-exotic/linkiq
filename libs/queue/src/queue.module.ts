import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'click-events' }),
    BullModule.registerQueue({ name: 'cleanup' }),
  ],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
