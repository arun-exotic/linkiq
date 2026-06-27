import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { CacheService } from '@app/cache';
import { PrismaService } from '@app/prisma';
import { Job, Queue } from 'bullmq';
import { QUEUES } from '@app/queue';
import { CLEANUP_SCHEDULE, CONCURRENCY } from '../queue.config';

@Processor(QUEUES.CLEANUP, { concurrency: CONCURRENCY.CLEANUP })
export class CleanupProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(CleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    @InjectQueue(QUEUES.CLEANUP) private readonly cleanupQueue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    try {
      await this.cleanupQueue.add(
        'cleanup-expired-slugs',
        {},
        CLEANUP_SCHEDULE.EXPIRED_SLUGS,
      );
      await this.cleanupQueue.add(
        'cleanup-refresh-tokens',
        {},
        CLEANUP_SCHEDULE.REFRESH_TOKENS,
      );
      this.logger.log('Registered repeatable cleanup jobs');
    } catch (err) {
      this.logger.error('Failed to register cleanup jobs', err);
    }
  }

  async process(job: Job) {
    if (job.name === 'cleanup-expired-slugs') {
      await this.cleanExpiredSlugs();
    } else if (job.name === 'cleanup-refresh-tokens') {
      await this.cleanRefreshTokens();
    }
  }

  private async cleanExpiredSlugs() {
    const expiredLinks = await this.prisma.link.findMany({
      where: { expiresAt: { lt: new Date() }, deletedAt: null },
      select: { slug: true },
    });

    for (const link of expiredLinks) {
      await this.cache.del(`slug:${link.slug}`).catch(() => {});
    }

    this.logger.log(
      `Evicted ${expiredLinks.length} expired slug keys from Redis`,
    );
  }

  private async cleanRefreshTokens() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await this.prisma.refreshToken.deleteMany({
      where: {
        createdAt: { lt: thirtyDaysAgo },
        OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: new Date() } }],
      },
    });

    this.logger.log(`Deleted ${result.count} stale refresh tokens`);
  }
}
