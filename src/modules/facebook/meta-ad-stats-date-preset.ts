export const DEFAULT_META_AD_STATS_DATE_PRESET = 'maximum' as const;

export function formatMetaAdStatsDatePresetLabel(
  preset: string | null | undefined,
): string {
  switch ((preset ?? '').trim()) {
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
      return 'All available history';
    default:
      return 'All available history';
  }
}
