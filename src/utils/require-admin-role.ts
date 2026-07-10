import { ForbiddenException } from '@nestjs/common';
import { isAdminOrSuperAdmin } from './user-roles';

type UserLike = {
  role?: { name: string } | null;
} | null;

export function requireAdminRole(
  user: UserLike,
  forbiddenMessage = 'You do not have permission to perform this action.',
): void {
  if (!isAdminOrSuperAdmin(user)) {
    throw new ForbiddenException(forbiddenMessage);
  }
}
