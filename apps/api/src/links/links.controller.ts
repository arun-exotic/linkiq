import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, RateLimitGuard } from '@app/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateLinkDto } from './dto/create-link.dto';
import { LinksService } from './links.service';

@Controller('links')
@UseGuards(JwtAuthGuard)
export class LinksController {
  constructor(private readonly linksService: LinksService) {}

  @Post()
  @UseGuards(RateLimitGuard)
  @HttpCode(201)
  create(
    @Body() dto: CreateLinkDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.linksService.create(dto, user.id);
  }

  @Get()
  async findAll(@CurrentUser() user: { id: string }) {
    const data = await this.linksService.findAllByUser(user.id);
    return { data, total: data.length };
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.linksService.delete(id, user.id);
  }
}
