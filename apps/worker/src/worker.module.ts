import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CacheModule } from '@app/cache';
import { ConfigModule } from '@app/config';
import { PrismaModule } from '@app/prisma';
import { ClicksModule } from './clicks/clicks.module';
import { getQueueConnection } from './queue.config';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CacheModule,
    BullModule.forRoot({ connection: getQueueConnection() }),
    ClicksModule,
  ],
})
export class WorkerModule {}
