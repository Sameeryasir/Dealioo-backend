import {
  adsMonthBounds,
  adsMonthSnapshotKey,
  DEFAULT_ADS_INSIGHTS_PERIOD,
  isAdsMaximumPeriod,
  normalizeAdsInsightsPeriodInput,
  parseAdsMonthPeriod,
} from '../../utils/ads-insights-period';

export const DEFAULT_META_INSIGHTS_PERIOD = DEFAULT_ADS_INSIGHTS_PERIOD;

const META_DATE_PRESETS = new Set([
  'today',
  'yesterday',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'last_3d',
  'last_7d',
  'last_14d',
  'last_28d',
  'last_30d',
  'last_90d',
  'maximum',
  'data_maximum',
]);

export type ResolvedMetaInsightsPeriod = {
  snapshotKey: string;
  displayKey: string;
  graphParams: Record<string, string>;
};

export function resolveMetaInsightsPeriod(
  raw?: string | null,
): ResolvedMetaInsightsPeriod {
  const value = normalizeAdsInsightsPeriodInput(
    raw,
    DEFAULT_META_INSIGHTS_PERIOD,
  );

  if (META_DATE_PRESETS.has(value)) {
    const preset = isAdsMaximumPeriod(value) ? 'maximum' : value;
    return {
      snapshotKey: preset,
      displayKey: preset,
      graphParams: { date_preset: preset },
    };
  }

  const month = parseAdsMonthPeriod(value);
  if (month) {
    const { since, until } = adsMonthBounds(month.year, month.month);
    return {
      snapshotKey: adsMonthSnapshotKey(month.key),
      displayKey: month.key,
      graphParams: {
        time_range: JSON.stringify({ since, until }),
      },
    };
  }

  return resolveMetaInsightsPeriod(DEFAULT_META_INSIGHTS_PERIOD);
}
