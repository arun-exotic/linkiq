import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(CacheService.name);

  constructor(config: ConfigService) {
    this.redis = new Redis({
      host: config.get<string>('redis.host')!,
      port: config.get<number>('redis.port')!,
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
    this.redis.on('error', (err: Error) =>
      this.logger.error('Redis error', err.message),
    );
  }

  get client(): Redis {
    return this.redis;
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async setNX(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
