import { Controller, Get, Post, Patch, Delete, Param, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RulesService } from './rules.service';

@ApiTags('rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'rules', version: '1' })
export class RulesController {
  constructor(private rules: RulesService) {}

  @Get()
  list(@Req() req: any) {
    return this.rules.list(req.user.userId);
  }

  @Get('active')
  active(@Req() req: any) {
    return this.rules.getActive(req.user.userId);
  }

  @Post()
  create(@Req() req: any, @Body() body: { name: string; conditions: unknown }) {
    return this.rules.create(req.user.userId, body.name, body.conditions);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.rules.update(req.user.userId, id, body);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.rules.remove(req.user.userId, id);
  }

  @Post('simulate')
  simulate(@Req() req: any, @Body() body: { conditions: unknown }) {
    return this.rules.simulate(req.user.userId, body.conditions);
  }
}
