import type { SidebarUnreadSection } from '../../db/entities/business-user-sidebar-section-read-state.entity';

export const SIDEBAR_UNREAD_SECTIONS = [
  'orders',
  'activity',
  'history',
] as const satisfies readonly SidebarUnreadSection[];

export function isSidebarUnreadSection(
  value: string,
): value is SidebarUnreadSection {
  return (SIDEBAR_UNREAD_SECTIONS as readonly string[]).includes(value);
}
