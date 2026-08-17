import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { requireAdminRole } from '../../utils/require-admin-role';

@Injectable()
export class BillingAccountOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: { role?: { name: string } | null };
    }>();
    requireAdminRole(
      request.user ?? null,
      'Only the account owner can manage billing.',
    );
    return true;
  }
}
