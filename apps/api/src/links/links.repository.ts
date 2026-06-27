import { Injectable } from '@nestjs/common';
import { PrismaService } from '@app/prisma';

@Injectable()
export class LinksRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    slug: string;
    destination: string;
    userId: string;
    title?: string;
    expiresAt?: Date;
  }) {
    return this.prisma.link.create({ data });
  }

  async findById(id: string) {
    return this.prisma.link.findFirst({
      where: { id, deletedAt: null },
    });
  }

  async findBySlug(slug: string) {
    return this.prisma.link.findFirst({
      where: { slug, deletedAt: null },
    });
  }

  async findAllByUser(userId: string) {
    return this.prisma.link.findMany({
      where: { userId, deletedAt: null },
      include: { _count: { select: { clicks: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async softDelete(id: string, userId: string) {
    return this.prisma.link.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
}
