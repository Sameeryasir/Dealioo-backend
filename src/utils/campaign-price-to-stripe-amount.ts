const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
]);

export function campaignPriceToStripeAmount(
  price: string | number | null | undefined,
  currency: string,
): number {
  if (price === null || price === undefined) {
    return NaN;
  }
  const major = typeof price === 'string' ? Number.parseFloat(price) : Number(price);
  if (!Number.isFinite(major) || major <= 0) {
    return NaN;
  }
  const cur = currency.toLowerCase().trim();
  if (ZERO_DECIMAL_CURRENCIES.has(cur)) {
    return Math.round(major);
  }
  return Math.round(major * 100);
}
