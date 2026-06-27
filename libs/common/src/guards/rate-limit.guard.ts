import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { CacheService } from '@app/cache';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly cache: CacheService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<{ user: { id: string } }>();
    const user = req.user;
    const key = `rate:create:${user.id}`;
    const now = Date.now();
    const window = 3600 * 1000;
    const limit = 100;

    const client = this.cache.client;
    await client.zadd(key, now, `${now}-${Math.random()}`);
    await client.zremrangebyscore(key, 0, now - window);
    const count = await client.zcard(key);
    await client.expire(key, 3600);

    if (count > limit) {
      throw new HttpException(
        { statusCode: 429, message: 'Rate limit exceeded', retryAfter: 3600 },
        429,
      );
    }
    return true;
  }
}
