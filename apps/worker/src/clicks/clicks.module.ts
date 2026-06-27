import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CleanupProcessor } from './cleanup.processor';
import { ClicksProcessor } from './clicks.processor';
import { ClicksService } from './clicks.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'click-events' }),
    BullModule.registerQueue({ name: 'cleanup' }),
  ],
  providers: [ClicksService, ClicksProcessor, CleanupProcessor],
})
export class ClicksModule {}
