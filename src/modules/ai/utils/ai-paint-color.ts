const NAMED_CSS_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#FFFFFF',
  red: '#EF4444',
  blue: '#2563EB',
  green: '#16A34A',
  yellow: '#EAB308',
  orange: '#EA580C',
  purple: '#7C3AED',
  pink: '#DB2777',
  gray: '#6B7280',
  grey: '#6B7280',
  cyan: '#06B6D4',
  teal: '#0D9488',
  indigo: '#4F46E5',
  violet: '#8B5CF6',
  rose: '#F43F5E',
  slate: '#64748B',
  zinc: '#71717A',
  navy: '#1E3A5F',
  maroon: '#7F1D1D',
  gold: '#D4AF37',
};

const COLOR_FIELD_KEYS = new Set([
  'ctaBackgroundColor',
  'ctaTextColor',
  'headlineColor',
  'subheadlineColor',
  'bodyColor',
  'backgroundColor',
  'buttonBackgroundColor',
  'buttonTextColor',
  'buttonColor',
  'headingColor',
  'subheadingColor',
]);

export function isAiColorFieldKey(key: string): boolean {
  return COLOR_FIELD_KEYS.has(key);
}

export function normalizeAiPaintColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const raw = value.trim();
  if (!raw) {
    return '';
  }

  const withHash = raw.startsWith('#') ? raw : `#${raw}`;
  if (/^#[0-9A-Fa-f]{3}$/.test(withHash)) {
    const r = withHash[1];
    const g = withHash[2];
    const b = withHash[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  if (/^#[0-9A-Fa-f]{6}$/.test(withHash)) {
    return withHash.toUpperCase();
  }

  const named = NAMED_CSS_COLORS[raw.toLowerCase()];
  return named ?? null;
}
