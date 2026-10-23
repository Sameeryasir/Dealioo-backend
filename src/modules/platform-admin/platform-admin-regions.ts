const REGION_ALIASES: Record<string, string> = {
  us: 'North America',
  usa: 'North America',
  'united states': 'North America',
  'united states of america': 'North America',
  canada: 'North America',
  mexico: 'North America',
  uk: 'Europe',
  'united kingdom': 'Europe',
  england: 'Europe',
  scotland: 'Europe',
  wales: 'Europe',
  ireland: 'Europe',
  germany: 'Europe',
  france: 'Europe',
  spain: 'Europe',
  italy: 'Europe',
  netherlands: 'Europe',
  belgium: 'Europe',
  portugal: 'Europe',
  sweden: 'Europe',
  norway: 'Europe',
  denmark: 'Europe',
  finland: 'Europe',
  switzerland: 'Europe',
  austria: 'Europe',
  poland: 'Europe',
  pakistan: 'Asia',
  india: 'Asia',
  bangladesh: 'Asia',
  'sri lanka': 'Asia',
  china: 'Asia',
  japan: 'Asia',
  korea: 'Asia',
  'south korea': 'Asia',
  singapore: 'Asia',
  malaysia: 'Asia',
  indonesia: 'Asia',
  thailand: 'Asia',
  vietnam: 'Asia',
  philippines: 'Asia',
  uae: 'Asia',
  'united arab emirates': 'Asia',
  'saudi arabia': 'Asia',
  qatar: 'Asia',
  australia: 'Australia',
  'new zealand': 'Australia',
  brazil: 'South America',
  argentina: 'South America',
  chile: 'South America',
  colombia: 'South America',
  peru: 'South America',
  'south africa': 'Africa',
  nigeria: 'Africa',
  kenya: 'Africa',
  egypt: 'Africa',
  ghana: 'Africa',
};

const REGION_ORDER = [
  'North America',
  'Asia',
  'Australia',
  'Europe',
  'South America',
  'Africa',
  'Other',
] as const;

export function countryToRegion(country: string | null | undefined): string {
  const raw = country?.trim();
  if (!raw) return 'Other';
  const key = raw.toLowerCase();
  if (REGION_ALIASES[key]) return REGION_ALIASES[key];
  if (key === 'us' || key === 'ca' || key === 'mx') return 'North America';
  if (key === 'au' || key === 'nz') return 'Australia';
  if (
    key === 'pk' ||
    key === 'in' ||
    key === 'cn' ||
    key === 'jp' ||
    key === 'sg'
  ) {
    return 'Asia';
  }
  if (
    key === 'gb' ||
    key === 'uk' ||
    key === 'de' ||
    key === 'fr' ||
    key === 'es' ||
    key === 'it'
  ) {
    return 'Europe';
  }
  return 'Other';
}

export function buildRegionBreakdown(
  countries: Array<string | null | undefined>,
): Array<{ region: string; count: number; sharePct: number }> {
  const counts = new Map<string, number>();
  for (const country of countries) {
    const region = countryToRegion(country);
    counts.set(region, (counts.get(region) ?? 0) + 1);
  }
  return finalizeRegionCounts(counts);
}

export function buildRegionBreakdownFromCountryCounts(
  rows: Array<{ country: string | null | undefined; count: number }>,
): Array<{ region: string; count: number; sharePct: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const region = countryToRegion(row.country);
    const n = Number.isFinite(row.count)
      ? Math.max(0, Math.floor(row.count))
      : 0;
    if (n <= 0) continue;
    counts.set(region, (counts.get(region) ?? 0) + n);
  }
  return finalizeRegionCounts(counts);
}

function finalizeRegionCounts(
  counts: Map<string, number>,
): Array<{ region: string; count: number; sharePct: number }> {
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const rows: Array<{ region: string; count: number; sharePct: number }> =
    REGION_ORDER.map((region) => {
      const count = counts.get(region) ?? 0;
      return {
        region,
        count,
        sharePct: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      };
    }).filter((row) => row.count > 0);

  for (const [region, count] of counts) {
    if ((REGION_ORDER as readonly string[]).includes(region)) continue;
    rows.push({
      region,
      count,
      sharePct: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    });
  }

  return rows.sort((a, b) => b.count - a.count);
}
