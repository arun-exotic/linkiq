import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CacheModule } from '@app/cache';
import { PrismaModule } from '@app/prisma';
import { ClicksModule } from './clicks/clicks.module';

@Module({
  imports: [
    PrismaModule,
    CacheModule,
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      },
    }),
    ClicksModule,
  ],
})
export class WorkerModule {}
