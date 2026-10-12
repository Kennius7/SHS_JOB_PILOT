import { Controller, Post, Body, Req, Res, HttpCode, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto } from './dto';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email, dto.password);
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(
      dto.email,
      dto.password,
      req.headers['user-agent'],
      req.ip,
    );
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30) * 86400_000,
      path: '/api/v1/auth',
    });
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req as any).cookies?.refreshToken;
    if (!token) throw new UnauthorizedException('No refresh token');
    const result = await this.auth.refresh(token);
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30) * 86400_000,
      path: '/api/v1/auth',
    });
    return { accessToken: result.accessToken };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req as any).cookies?.refreshToken;
    if (token) await this.auth.logout(token).catch(() => {});
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
  }
}
