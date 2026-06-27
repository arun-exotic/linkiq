import { Injectable } from '@nestjs/common';
import { LinkResolverService } from '../links/link-resolver.service';
import { QueueService } from '@app/queue';
import { Request, Response } from 'express';

@Injectable()
export class RedirectService {
  constructor(
    private readonly linkResolver: LinkResolverService,
    private readonly queue: QueueService,
  ) {}

  async redirect(
    slug: string,
    req: Request & { correlationId?: string },
    res: Response,
  ) {
    const link = await this.linkResolver.resolveBySlug(slug);

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
}
