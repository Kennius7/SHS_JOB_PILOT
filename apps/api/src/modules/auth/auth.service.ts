import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '@shs/data';
import { MailerService } from '../email/email.service';
import { isAllowlistedAdmin } from './admin-allowlist';

type TokenType = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private mailer: MailerService,
  ) {}

  async register(email: string, password: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: { email, passwordHash },
      select: { id: true, email: true, role: true, createdAt: true },
    });
    const token = await this.issueToken(user.id, 'EMAIL_VERIFICATION', VERIFICATION_TTL_MS);
    await this.mailer.sendVerification(user.email, token);
    return user;
  }

  async login(email: string, password: string, userAgent?: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) throw new UnauthorizedException('Invalid credentials');
    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const accessToken = this.jwt.sign(
      { sub: user.id, role: user.role, email: user.email },
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
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isAdmin: isAllowlistedAdmin(user.email, user.role),
      },
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
      { sub: session.user.id, role: session.user.role, email: session.user.email },
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

  async verifyEmail(rawToken: string) {
    const token = await this.consumeToken(rawToken, 'EMAIL_VERIFICATION');
    if (token.user.emailVerified) return { verified: true };
    await this.prisma.user.update({
      where: { id: token.userId },
      data: { emailVerified: new Date() },
    });
    return { verified: true };
  }

  async resendVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new UnauthorizedException();
    if (user.emailVerified) throw new BadRequestException('Email already verified');
    const token = await this.issueToken(userId, 'EMAIL_VERIFICATION', VERIFICATION_TTL_MS);
    await this.mailer.sendVerification(user.email, token);
    return { sent: true };
  }

  async requestPasswordReset(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && !user.deletedAt) {
      const token = await this.issueToken(user.id, 'PASSWORD_RESET', RESET_TTL_MS);
      await this.mailer.sendPasswordReset(user.email, token);
    }
    return { sent: true };
  }

  async resetPassword(rawToken: string, password: string) {
    const token = await this.consumeToken(rawToken, 'PASSWORD_RESET');
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      }),
      this.prisma.userSession.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { reset: true };
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private async issueToken(userId: string, type: TokenType, ttlMs: number): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    await this.prisma.verificationToken.create({
      data: {
        userId,
        type,
        tokenHash: this.hashToken(raw),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return raw;
  }

  private async consumeToken(raw: string, type: TokenType) {
    const token = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: this.hashToken(raw) },
      include: { user: true },
    });
    if (!token || token.type !== type || token.usedAt || token.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired token');
    }
    await this.prisma.verificationToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });
    return token;
  }
}
