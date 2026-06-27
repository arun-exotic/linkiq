import { Injectable } from '@nestjs/common';
import { PrismaService } from '@app/prisma';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, createdAt: true },
    });
  }

  async create(data: { email: string; password: string; name?: string }) {
    const hash = await bcrypt.hash(data.password, 12);
    return this.prisma.user.create({
      data: { email: data.email, password: hash, name: data.name },
      select: { id: true, email: true, name: true, createdAt: true },
    });
  }
}
