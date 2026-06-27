import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { RedirectService } from './redirect.service';

@Controller()
export class RedirectController {
  constructor(private readonly redirectService: RedirectService) {}

  @Get(':slug')
  async redirect(
    @Param('slug') slug: string,
    @Req() req: Request & { correlationId?: string },
    @Res() res: Response,
  ) {
    return this.redirectService.redirect(slug, req, res);
  }
}
