export const ADMIN_ROLE = 'Admin';
export const SUPER_ADMIN_ROLE = 'Super Admin';
export const SCANNER_ROLE = 'Scanner';
export const MANAGER_ROLE = 'Manager';
export const STAFF_ROLE = 'Staff';

type UserLike = {
  role?: { name: string } | null;
} | null;

export function getRoleName(user: UserLike): string | null {
  const name = user?.role?.name?.trim();
  return name || null;
}

export function isSuperAdminRole(roleName: string | null | undefined): boolean {
  return roleName?.trim() === SUPER_ADMIN_ROLE;
}

export function isAdminRole(roleName: string | null | undefined): boolean {
  return roleName?.trim() === ADMIN_ROLE;
}

export function isAdminOrSuperAdmin(user: UserLike): boolean {
  const roleName = getRoleName(user);
  return isAdminRole(roleName) || isSuperAdminRole(roleName);
}

export function isSuperAdmin(user: UserLike): boolean {
  return isSuperAdminRole(getRoleName(user));
}
