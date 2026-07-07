function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, '');
}

function getAllowedOrigins(): string[] {
  const raw = process.env.FRONTEND_URL?.trim();
  if (!raw) {
    return ['http://localhost:3002'];
  }

  return raw
    .split(',')
    .map(normalizeOrigin)
    .filter((origin) => origin.length > 0);
}

export function getFrontendBaseUrl(): string {
  return getAllowedOrigins()[0] ?? 'http://localhost:3002';
}

export function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  return getAllowedOrigins().includes(normalizeOrigin(origin));
}
