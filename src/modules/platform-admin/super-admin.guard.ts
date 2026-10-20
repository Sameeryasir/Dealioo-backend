import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { isSuperAdmin } from '../../utils/user-roles';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: { role?: { name: string } | null } | null;
    }>();

    const roleName = request.user?.role?.name ?? null;
    if (!isSuperAdmin({ role: roleName ? { name: roleName } : null })) {
      throw new ForbiddenException(
        'Only Super Admin can access the platform admin API.',
      );
    }

    return true;
  }
}
