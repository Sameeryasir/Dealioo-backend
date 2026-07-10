import { isAdminRole, isSuperAdmin, getRoleName } from './user-roles';

export type BusinessAccessUser = {
  id: number;
  role?: { name: string } | null;
};

export function businessAccessWhere(
  user: BusinessAccessUser,
  businessId: number,
): { id: number; owner?: { id: number } } {
  if (isSuperAdmin(user)) {
    return { id: businessId };
  }

  return { id: businessId, owner: { id: user.id } };
}

export function isBusinessOwnerScopedUser(user: BusinessAccessUser): boolean {
  const roleName = getRoleName(user);
  return isAdminRole(roleName) && !isSuperAdmin(user);
}

export function isBusinessOwnerScopedRole(roleName: string | null | undefined): boolean {
  return isAdminRole(roleName);
}
