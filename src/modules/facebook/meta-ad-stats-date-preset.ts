import { DEFAULT_ADS_INSIGHTS_PERIOD } from '../../utils/ads-insights-period';

export const DEFAULT_META_AD_STATS_DATE_PRESET = DEFAULT_ADS_INSIGHTS_PERIOD;

export function formatMetaAdStatsDatePresetLabel(
  preset: string | null | undefined,
): string {
  const value = (preset ?? '').trim();
  const monthMatch = /^m?:?(\d{4})-(\d{2})$/.exec(value);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    if (month >= 1 && month <= 12) {
      return new Intl.DateTimeFormat(undefined, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(year, month - 1, 1)));
    }
  }

  switch (value.toLowerCase()) {
    case 'today':
      return 'Today';
    case 'yesterday':
      return 'Yesterday';
    case 'last_3d':
      return 'Last 3 days';
    case 'last_7d':
      return 'Last 7 days';
    case 'last_14d':
      return 'Last 14 days';
    case 'last_28d':
      return 'Last 28 days';
    case 'last_30d':
      return 'Last 30 days';
    case 'last_90d':
      return 'Last 90 days';
    case 'this_month':
      return 'This month';
    case 'last_month':
      return 'Last month';
    case 'this_quarter':
      return 'This quarter';
    case 'last_quarter':
      return 'Last quarter';
    case 'this_year':
      return 'This year';
    case 'last_year':
      return 'Last year';
    case 'maximum':
    case 'data_maximum':
    case 'all_time':
      return 'All available history';
    default:
      return 'This month';
  }
}
