import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsageService } from './usage.service';

@ApiTags('usage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'usage', version: '1' })
export class UsageController {
  constructor(private usage: UsageService) {}

  @Get()
  summary(@Req() req: any) {
    return this.usage.summary(req.user.userId);
  }
}
