import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheModule } from '@app/cache';
import { ConfigModule } from '@app/config';
import { PrismaModule } from '@app/prisma';
import { QueueModule } from '@app/queue';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { LinksModule } from './links/links.module';
import { RedirectModule } from './redirect/redirect.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CacheModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host')!,
          port: config.get<number>('redis.port')!,
        },
      }),
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
