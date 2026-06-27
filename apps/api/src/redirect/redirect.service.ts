import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '@app/cache';
import { QueueService } from '@app/queue';
import { Request, Response } from 'express';
import { LinksRepository } from '../links/links.repository';

@Injectable()
export class RedirectService {
  private readonly logger = new Logger(RedirectService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly linksRepository: LinksRepository,
    private readonly queue: QueueService,
  ) {}

  async redirect(
    slug: string,
    req: Request & { correlationId?: string },
    res: Response,
  ) {
    const link = await this.resolveSlug(slug);

    if (!link) {
      res.status(404).send();
      return;
    }

    if (link.deletedAt || (link.expiresAt && link.expiresAt < new Date())) {
      res.status(410).send();
      return;
    }

    res.redirect(302, link.destination);

    void this.queue.enqueueClick({
      linkId: link.id,
      ip: req.ip ?? '0.0.0.0',
      userAgent: req.headers['user-agent'],
      referer: req.headers['referer'] as string | undefined,
      timestamp: new Date().toISOString(),
      correlationId:
        req.correlationId ??
        (req.headers['x-correlation-id'] as string) ??
        '',
    });
  }

  private async resolveSlug(slug: string) {
    try {
      const cached = await this.cache.get(`slug:${slug}`);
      if (cached)
        return JSON.parse(cached) as Record<string, unknown> & {
          id: string;
          destination: string;
          deletedAt: string | null;
          expiresAt: string | null;
        };
    } catch {
      this.logger.warn('Redis unavailable, falling back to Postgres');
    }

    const link = await this.linksRepository.findBySlug(slug);
    if (link) {
      await this.cache
        .set(`slug:${slug}`, JSON.stringify(link), 86400)
        .catch(() => {});
    }
    return link;
  }
}
