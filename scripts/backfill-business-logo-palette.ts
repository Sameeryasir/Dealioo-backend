import 'reflect-metadata';
import { config } from 'dotenv';
import { IsNull, Not } from 'typeorm';
import AppDataSource from '../src/data-source';
import { Business } from '../src/db/entities/business.entity';
import { extractLogoPaletteFromBuffer } from '../src/utils/extract-logo-palette';
import { toDigitalOceanSpacesCdnUrl } from '../src/utils/spaces-cdn-url';

config();

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

function resolveLogoFetchUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:')
  ) {
    return toDigitalOceanSpacesCdnUrl(trimmed);
  }

  const apiBase =
    process.env.APP_URL?.trim()?.replace(/\/$/, '') ||
    process.env.BACKEND_URL?.trim()?.replace(/\/$/, '') ||
    process.env.API_PUBLIC_URL?.trim()?.replace(/\/$/, '') ||
    '';

  if (trimmed.startsWith('/uploads/')) {
    return apiBase ? `${apiBase}${trimmed}` : null;
  }
  if (trimmed.startsWith('uploads/')) {
    return apiBase ? `${apiBase}/${trimmed}` : null;
  }

  return null;
}

async function fetchLogoBuffer(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
    });
    if (!response.ok) {
      console.warn(`  fetch failed (${response.status}): ${url}`);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    if (!arrayBuffer.byteLength) return null;
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.warn(
      `  fetch error: ${url} — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(Business);

  const where = force
    ? { logoUrl: Not(IsNull()) }
    : [
        {
          logoUrl: Not(IsNull()),
          logoPrimaryColor: IsNull(),
        },
        {
          logoUrl: Not(IsNull()),
          logoSecondaryColor: IsNull(),
        },
        {
          logoUrl: Not(IsNull()),
          logoAccentColor: IsNull(),
        },
      ];

  const businesses = await repo.find({
    where,
    select: [
      'id',
      'name',
      'logoUrl',
      'logoPrimaryColor',
      'logoSecondaryColor',
      'logoAccentColor',
    ],
    withDeleted: false,
  });

  const unique = new Map<number, Business>();
  for (const business of businesses) {
    if (!business.logoUrl?.trim()) continue;
    if (
      !force &&
      business.logoPrimaryColor &&
      business.logoSecondaryColor &&
      business.logoAccentColor
    ) {
      continue;
    }
    unique.set(business.id, business);
  }

  const targets = [...unique.values()];
  console.log(
    `${dryRun ? '[dry-run] ' : ''}Businesses to backfill: ${targets.length}`,
  );

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const business of targets) {
    const logoUrl = business.logoUrl?.trim() ?? '';
    const fetchUrl = resolveLogoFetchUrl(logoUrl);
    console.log(`#${business.id} ${business.name}`);
    console.log(`  logo: ${logoUrl}`);

    if (!fetchUrl) {
      console.warn('  skip: could not resolve fetch URL');
      skipped += 1;
      continue;
    }

    const buffer = await fetchLogoBuffer(fetchUrl);
    if (!buffer) {
      failed += 1;
      continue;
    }

    const palette = await extractLogoPaletteFromBuffer(buffer);
    if (
      !palette.logoPrimaryColor &&
      !palette.logoSecondaryColor &&
      !palette.logoAccentColor
    ) {
      console.warn('  skip: no colors extracted');
      skipped += 1;
      continue;
    }

    console.log(
      `  colors: ${palette.logoPrimaryColor} / ${palette.logoSecondaryColor} / ${palette.logoAccentColor}`,
    );

    if (!dryRun) {
      await repo.update(business.id, {
        logoPrimaryColor: palette.logoPrimaryColor,
        logoSecondaryColor: palette.logoSecondaryColor,
        logoAccentColor: palette.logoAccentColor,
      });
    }
    updated += 1;
  }

  console.log(
    `${dryRun ? '[dry-run] ' : ''}Done. updated=${updated} skipped=${skipped} failed=${failed}`,
  );
  await AppDataSource.destroy();
}

main().catch(async (error) => {
  console.error(error);
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
  process.exit(1);
});
