export function getFrontendBaseUrl(): string {
  const raw =
    process.env.FRONTEND_URL?.trim() || process.env.CORS_ORIGIN?.trim();
  if (!raw) {
    return 'http://localhost:3002';
  }
  return raw.replace(/\/$/, '');
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, '');
}

export function getCorsOrigins(): string[] {
  const origins = new Set<string>();

  const devPort = process.env.FRONTEND_DEV_PORT?.trim() || '3002';
  origins.add(`http://localhost:${devPort}`);
  origins.add(`http://127.0.0.1:${devPort}`);

  const envValues = [
    process.env.FRONTEND_URL,
    process.env.CORS_ORIGIN,
    process.env.CORS_ORIGINS,
  ];

  for (const entry of envValues) {
    if (!entry?.trim()) continue;
    for (const part of entry.split(',')) {
      const normalized = normalizeOrigin(part);
      if (normalized) origins.add(normalized);
    }
  }

  return [...origins];
}
