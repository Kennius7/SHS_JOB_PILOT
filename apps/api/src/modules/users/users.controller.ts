import { Controller, Get, Delete, Req, UseGuards, HttpCode } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private users: UsersService) {}

  @Get('me')
  me(@Req() req: any) {
    return this.users.me(req.user.userId);
  }

  @Delete('me')
  @HttpCode(200)
  deleteAccount(@Req() req: any) {
    return this.users.deleteAccount(req.user.userId);
  }
}
