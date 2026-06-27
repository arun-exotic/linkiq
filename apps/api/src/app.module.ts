import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CacheModule } from '@app/cache';
import { PrismaModule } from '@app/prisma';
import { QueueModule } from '@app/queue';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { LinksModule } from './links/links.module';
import { RedirectModule } from './redirect/redirect.module';
import { UsersModule } from './users/users.module';

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
    UsersModule,
    AuthModule,
    QueueModule,
    LinksModule,
    RedirectModule,
    HealthModule,
  ],
})
export class AppModule {}
