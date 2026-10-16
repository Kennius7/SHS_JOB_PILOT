import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@shs/data';
import { isAllowlistedAdmin } from '../auth/admin-allowlist';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        emailVerified: true,
        isActive: true,
        createdAt: true,
        profile: {
          select: {
            fullName: true,
            onboardingStep: true,
            onboardingCompletedAt: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return { ...user, isAdmin: isAllowlistedAdmin(user.email, user.role) };
  }

  async deleteAccount(userId: string) {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { deletedAt: new Date(), isActive: false },
      }),
      this.prisma.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { deleted: true };
  }
}
