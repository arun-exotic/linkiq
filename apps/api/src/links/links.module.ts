import { Module } from '@nestjs/common';
import { QueueModule } from '@app/queue';
import { AuthModule } from '../auth/auth.module';
import { LinkResolverService } from './link-resolver.service';
import { LinksController } from './links.controller';
import { LinksRepository } from './links.repository';
import { LinksService } from './links.service';

@Module({
  imports: [AuthModule, QueueModule],
  controllers: [LinksController],
  providers: [LinksService, LinksRepository, LinkResolverService],
  exports: [LinksRepository, LinkResolverService],
})
export class LinksModule {}
