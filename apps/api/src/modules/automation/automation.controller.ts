import { Controller, Get, Post, Req, UseGuards, HttpCode } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AutomationService } from './automation.service';

@ApiTags('automation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'automation', version: '1' })
export class AutomationController {
  constructor(private automation: AutomationService) {}

  @Get('status')
  status(@Req() req: any) {
    return this.automation.status(req.user.userId);
  }

  @Post('pause')
  @HttpCode(200)
  pause(@Req() req: any) {
    return this.automation.pause(req.user.userId);
  }

  @Post('resume')
  @HttpCode(200)
  resume(@Req() req: any) {
    return this.automation.resume(req.user.userId);
  }
}
