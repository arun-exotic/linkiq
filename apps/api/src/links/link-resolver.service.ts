import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '@app/cache';
import { LinksRepository } from './links.repository';

export interface ResolvedLink {
  id: string;
  destination: string;
  deletedAt: Date | null;
  expiresAt: Date | null;
}

@Injectable()
export class LinkResolverService {
  private readonly logger = new Logger(LinkResolverService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly linksRepository: LinksRepository,
  ) {}

  async resolveBySlug(slug: string): Promise<ResolvedLink | null> {
    try {
      const cached = await this.cache.get(`slug:${slug}`);
      if (cached) {
        return JSON.parse(cached) as ResolvedLink;
      }
    } catch {
      this.logger.warn('Redis unavailable, falling back to Postgres');
    }

    const link = await this.linksRepository.findBySlug(slug);
    if (link) {
      await this.cache
        .set(`slug:${slug}`, JSON.stringify(link), 86400)
        .catch(() => {});
      return link;
    }

    return null;
  }
}
