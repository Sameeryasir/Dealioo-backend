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

/** Dev-only: allow any ngrok tunnel without updating .env each time. */
export function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  const normalized = normalizeOrigin(origin);
  if (getCorsOrigins().includes(normalized)) {
    return true;
  }

  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  try {
    const { hostname, protocol } = new URL(normalized);
    return (
      protocol === 'https:' &&
      (hostname.endsWith('.ngrok-free.app') ||
        hostname.endsWith('.ngrok.io') ||
        hostname.endsWith('.ngrok.app'))
    );
  } catch {
    return false;
  }
}
