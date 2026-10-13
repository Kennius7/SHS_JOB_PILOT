import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '@shs/data';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async register(email: string, password: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    return this.prisma.user.create({
      data: { email, passwordHash },
      select: { id: true, email: true, role: true, createdAt: true },
    });
  }

  async login(email: string, password: string, userAgent?: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) throw new UnauthorizedException('Invalid credentials');
    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const accessToken = this.jwt.sign(
      { sub: user.id, role: user.role },
      { expiresIn: this.config.get('JWT_ACCESS_TTL', '15m') },
    );

    const refreshToken = randomBytes(48).toString('base64url');
    const refreshHash = createHash('sha256').update(refreshToken).digest('hex');
    const ttlDays = Number(this.config.get('REFRESH_TOKEN_TTL_DAYS', 30));

    await this.prisma.userSession.create({
      data: {
        userId: user.id,
        refreshHash,
        expiresAt: new Date(Date.now() + ttlDays * 86400_000),
        userAgent,
        ip,
      },
    });

    void this.prisma.auditLog
      .create({
        data: {
          userId: user.id,
          action: 'auth.login',
          target: 'user',
          metadata: { email: user.email },
          userAgent,
          ip,
        },
      })
      .catch(() => {});

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  async refresh(refreshToken: string) {
    const refreshHash = createHash('sha256').update(refreshToken).digest('hex');
    const session = await this.prisma.userSession.findUnique({
      where: { refreshHash },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const newRefreshToken = randomBytes(48).toString('base64url');
    const newRefreshHash = createHash('sha256').update(newRefreshToken).digest('hex');

    await this.prisma.userSession.create({
      data: {
        userId: session.userId,
        refreshHash: newRefreshHash,
        expiresAt: session.expiresAt,
        userAgent: session.userAgent,
        ip: session.ip,
      },
    });

    const accessToken = this.jwt.sign(
      { sub: session.user.id, role: session.user.role },
      { expiresIn: this.config.get('JWT_ACCESS_TTL', '15m') },
    );

    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(refreshToken: string) {
    const refreshHash = createHash('sha256').update(refreshToken).digest('hex');
    await this.prisma.userSession.updateMany({
      where: { refreshHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
