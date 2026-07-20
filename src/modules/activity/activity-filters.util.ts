import { ActivityEventType } from '../../db/entities/activity-event.entity';

export const ACTIVITY_DEFAULT_MONTH_COUNT = 6;

export const ACTIVITY_EVENT_TYPE_FILTERS = [
  'all',
  ActivityEventType.VISITED,
  ActivityEventType.REDEEMED_REWARD,
  ActivityEventType.PREPAID_FOR_OFFER,
  ActivityEventType.MESSAGE_SENT,
  ActivityEventType.CAMPAIGN_CREATED,
  ActivityEventType.CAMPAIGN_UPDATED,
  ActivityEventType.CAMPAIGN_DELETED,
] as const;

export type ActivityEventTypeFilter =
  (typeof ACTIVITY_EVENT_TYPE_FILTERS)[number];

export function parseActivityEventTypeFilter(
  raw?: string,
): ActivityEventType | null {
  if (!raw?.trim()) {
    return null;
  }

  const value = raw.trim().toLowerCase();
  if (value === 'all') {
    return null;
  }

  if (Object.values(ActivityEventType).includes(value as ActivityEventType)) {
    return value as ActivityEventType;
  }

  return null;
}

export function getDefaultActivityRangeStart(
  monthCount = ACTIVITY_DEFAULT_MONTH_COUNT,
): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (monthCount - 1), 1),
  );
}

export function resolveActivityDateRange(
  from?: Date | null,
  to?: Date | null,
  monthCount = ACTIVITY_DEFAULT_MONTH_COUNT,
): { from: Date; to: Date } {
  const now = new Date();

  return {
    from: from ?? getDefaultActivityRangeStart(monthCount),
    to: to ?? now,
  };
}

export function normalizeActivitySearch(search?: string): string | undefined {
  const trimmed = search?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function escapeIlikePattern(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}
