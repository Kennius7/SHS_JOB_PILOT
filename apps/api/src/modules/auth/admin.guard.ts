import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { isAllowlistedAdmin } from './admin-allowlist';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user as { role?: string; email?: string } | undefined;
    if (user?.role !== 'ADMIN') throw new ForbiddenException();
    if (!isAllowlistedAdmin(user.email, user.role)) {
      throw new ForbiddenException('Admin access is restricted to allowlisted accounts');
    }
    return true;
  }
}
