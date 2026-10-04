export type LogoPaletteColors = {
  logoPrimaryColor: string | null;
  logoSecondaryColor: string | null;
  logoAccentColor: string | null;
};

const EMPTY_PALETTE: LogoPaletteColors = {
  logoPrimaryColor: null,
  logoSecondaryColor: null,
  logoAccentColor: null,
};

type Rgb = { r: number; g: number; b: number; count: number };

function toHex({ r, g, b }: Pick<Rgb, 'r' | 'g' | 'b'>): string {
  return `#${[r, g, b]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

function luminance({ r, g, b }: Pick<Rgb, 'r' | 'g' | 'b'>): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function saturation({ r, g, b }: Pick<Rgb, 'r' | 'g' | 'b'>): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const delta = max - min;
  if (max === 0) return 0;
  return delta / max;
}

function colorDistance(
  a: Pick<Rgb, 'r' | 'g' | 'b'>,
  b: Pick<Rgb, 'r' | 'g' | 'b'>,
): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function quantizeKey(r: number, g: number, b: number): string {
  const qr = r >> 4;
  const qg = g >> 4;
  const qb = b >> 4;
  return `${qr},${qg},${qb}`;
}

function fromKey(key: string, count: number): Rgb {
  const [qr, qg, qb] = key.split(',').map((part) => Number(part));
  return {
    r: Math.min(255, qr * 16 + 8),
    g: Math.min(255, qg * 16 + 8),
    b: Math.min(255, qb * 16 + 8),
    count,
  };
}

function pickDistinct(colors: Rgb[], count: number): Rgb[] {
  const picked: Rgb[] = [];
  for (const color of colors) {
    if (picked.every((existing) => colorDistance(existing, color) >= 28)) {
      picked.push(color);
    }
    if (picked.length >= count) break;
  }
  return picked;
}

function buildPaletteFromPixels(
  data: Buffer,
  channels: number,
): LogoPaletteColors {
  const bucket = new Map<string, number>();
  const step = Math.max(1, Math.floor(data.length / (channels * 2500)));

  for (let i = 0; i + channels <= data.length; i += channels * step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = channels >= 4 ? data[i + 3] : 255;
    if (a < 96) continue;
    const lum = luminance({ r, g, b });
    if (lum > 0.94 || lum < 0.04) continue;
    const key = quantizeKey(r, g, b);
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  }

  const ranked = [...bucket.entries()]
    .map(([key, count]) => fromKey(key, count))
    .sort((a, b) => {
      const scoreA = a.count * (0.55 + saturation(a));
      const scoreB = b.count * (0.55 + saturation(b));
      return scoreB - scoreA;
    });

  if (ranked.length === 0) return EMPTY_PALETTE;

  const distinct = pickDistinct(ranked, 3);
  const primary = distinct[0] ?? ranked[0];
  const secondary =
    distinct[1] ??
    ranked.find((color) => colorDistance(color, primary) >= 20) ??
    primary;
  const accent =
    distinct[2] ??
    ranked.find(
      (color) =>
        colorDistance(color, primary) >= 20 &&
        colorDistance(color, secondary) >= 20,
    ) ??
    secondary;

  return {
    logoPrimaryColor: toHex(primary),
    logoSecondaryColor: toHex(secondary),
    logoAccentColor: toHex(accent),
  };
}

export async function extractLogoPaletteFromBuffer(
  buffer: Buffer | undefined | null,
): Promise<LogoPaletteColors> {
  if (!buffer?.length) return EMPTY_PALETTE;

  try {
    const sharp = (await import('sharp')).default;
    const { data, info } = await sharp(buffer)
      .rotate()
      .resize(96, 96, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return buildPaletteFromPixels(data, info.channels);
  } catch {
    return EMPTY_PALETTE;
  }
}

export async function extractLogoPaletteFromUpload(
  file: Express.Multer.File | undefined | null,
): Promise<LogoPaletteColors> {
  return extractLogoPaletteFromBuffer(file?.buffer);
}

export function clearLogoPalette(): LogoPaletteColors {
  return EMPTY_PALETTE;
}
