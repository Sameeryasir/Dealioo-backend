import { ForbiddenException } from '@nestjs/common';

type UserLike = {
  role?: { name: string } | null;
} | null;

export function requireAdminRole(
  user: UserLike,
  forbiddenMessage = 'You do not have permission to perform this action.',
): void {
  if (!user?.role || user.role.name !== 'Admin') {
    throw new ForbiddenException(forbiddenMessage);
  }
}
