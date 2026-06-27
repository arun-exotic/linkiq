import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { CacheService } from '@app/cache';
import { PrismaService } from '@app/prisma';
import { Job } from 'bullmq';

@Processor('cleanup')
export class CleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(CleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {
    super();
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
