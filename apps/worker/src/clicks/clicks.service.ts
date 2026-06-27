import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CacheService } from '@app/cache';
import { PrismaService } from '@app/prisma';
import { createHash } from 'crypto';
import * as geoip from 'geoip-lite';
import { UAParser } from 'ua-parser-js';

@Injectable()
export class ClicksService implements OnModuleInit {
  private readonly logger = new Logger(ClicksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  onModuleInit() {
    geoip.reloadDataSync();
  }

  async recordClick(data: {
    linkId: string;
    ip: string;
    userAgent?: string;
    referer?: string;
    timestamp: string;
    correlationId: string;
  }) {
    const ipHash = this.hashIp(data.ip);

    const dedupKey = `dedup:${ipHash}:${data.linkId}`;
    const isNew = await this.cache.setNX(dedupKey, '1', 1800);
    if (!isNew) {
      this.logger.debug(`Deduplicated click [${data.correlationId}]`);
      return;
    }

    const geo = geoip.lookup(data.ip);
    const ua = new UAParser(data.userAgent);
    const deviceType = ua.getDevice().type ?? 'desktop';

    await this.prisma.click.create({
      data: {
        linkId: data.linkId,
        clickedAt: new Date(data.timestamp),
        ipHash,
        country: geo?.country ?? null,
        city: geo?.city ?? null,
        userAgent: data.userAgent ?? null,
        referer: this.parseReferer(data.referer),
        deviceType,
      },
    });
  }

  private hashIp(ip: string): string {
    const salt = new Date().toISOString().slice(0, 10);
    return createHash('sha256').update(ip + salt).digest('hex');
  }

  private parseReferer(referer?: string): string {
    if (!referer) return 'direct';
    if (referer.includes('instagram.com')) return 'instagram';
    if (referer.includes('tiktok.com')) return 'tiktok';
    if (referer.includes('twitter.com') || referer.includes('t.co'))
      return 'twitter';
    if (referer.includes('facebook.com')) return 'facebook';
    if (referer.includes('linkedin.com')) return 'linkedin';
    return 'other';
  }
}
