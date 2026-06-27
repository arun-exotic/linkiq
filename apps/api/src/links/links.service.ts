import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '@app/cache';
import { generateSlug, isReserved } from '@app/common';
import { CreateLinkDto } from './dto/create-link.dto';
import { LinksRepository } from './links.repository';

@Injectable()
export class LinksService {
  constructor(
    private readonly linksRepository: LinksRepository,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateLinkDto, userId: string) {
    if (dto.slug && isReserved(dto.slug)) {
      throw new UnprocessableEntityException('Reserved slug');
    }
    return this.createWithRetry(dto, userId);
  }

  private async createWithRetry(
    dto: CreateLinkDto,
    userId: string,
    attempts = 3,
  ) {
    for (let i = 0; i < attempts; i++) {
      try {
        const slug = dto.slug ?? generateSlug();
        const link = await this.linksRepository.create({
          slug,
          destination: dto.destination,
          userId,
          title: dto.title,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        });
        await this.cache.set(`slug:${slug}`, JSON.stringify(link), 86400);
        return {
          ...link,
          shortUrl: `${this.config.get<string>('app.baseUrl')}/${link.slug}`,
        };
      } catch (err: unknown) {
        const prismaErr = err as { code?: string };
        if (prismaErr.code === 'P2002' && !dto.slug) continue;
        if (prismaErr.code === 'P2002' && dto.slug) {
          throw new ConflictException('Slug already taken');
        }
        throw err;
      }
    }
    throw new InternalServerErrorException('Failed to generate a unique slug');
  }

  async findAllByUser(userId: string) {
    const links = await this.linksRepository.findAllByUser(userId);
    return links.map((link) => ({
      ...link,
      clickCount: link._count.clicks,
      shortUrl: `${this.config.get<string>('app.baseUrl')}/${link.slug}`,
    }));
  }

  async delete(id: string, userId: string) {
    const link = await this.linksRepository.findById(id);
    if (!link || link.userId !== userId) {
      throw new NotFoundException('Link not found');
    }
    await this.linksRepository.softDelete(id, userId);
    await this.cache.del(`slug:${link.slug}`);
  }
}
