import {
  adsMonthBounds,
  adsMonthSnapshotKey,
  DEFAULT_ADS_INSIGHTS_PERIOD,
  isAdsMaximumPeriod,
  normalizeAdsInsightsPeriodInput,
  parseAdsMonthPeriod,
} from '../../utils/ads-insights-period';

export const DEFAULT_GOOGLE_INSIGHTS_PERIOD = DEFAULT_ADS_INSIGHTS_PERIOD;

const GOOGLE_DURING_PRESETS: Record<string, string> = {
  today: 'TODAY',
  yesterday: 'YESTERDAY',
  this_month: 'THIS_MONTH',
  last_month: 'LAST_MONTH',
  last_7d: 'LAST_7_DAYS',
  last_14d: 'LAST_14_DAYS',
  last_30d: 'LAST_30_DAYS',
};

export type ResolvedGoogleInsightsPeriod = {
  snapshotKey: string;
  displayKey: string;
  dateWhere: string;
};

function allHistoryBounds(): { since: string; until: string } {
  const end = new Date();
  const start = new Date(
    Date.UTC(end.getUTCFullYear() - 11, end.getUTCMonth(), 1),
  );
  return {
    since: start.toISOString().slice(0, 10),
    until: end.toISOString().slice(0, 10),
  };
}

export function resolveGoogleInsightsPeriod(
  raw?: string | null,
): ResolvedGoogleInsightsPeriod {
  const value = normalizeAdsInsightsPeriodInput(
    raw,
    DEFAULT_GOOGLE_INSIGHTS_PERIOD,
  );

  if (isAdsMaximumPeriod(value)) {
    const { since, until } = allHistoryBounds();
    return {
      snapshotKey: 'ALL_TIME',
      displayKey: 'maximum',
      dateWhere: `segments.date BETWEEN '${since}' AND '${until}'`,
    };
  }

  const during = GOOGLE_DURING_PRESETS[value];
  if (during) {
    return {
      snapshotKey: value,
      displayKey: value,
      dateWhere: `segments.date DURING ${during}`,
    };
  }

  const month = parseAdsMonthPeriod(value);
  if (month) {
    const { since, until } = adsMonthBounds(month.year, month.month);
    return {
      snapshotKey: adsMonthSnapshotKey(month.key),
      displayKey: month.key,
      dateWhere: `segments.date BETWEEN '${since}' AND '${until}'`,
    };
  }

  return resolveGoogleInsightsPeriod(DEFAULT_GOOGLE_INSIGHTS_PERIOD);
}
