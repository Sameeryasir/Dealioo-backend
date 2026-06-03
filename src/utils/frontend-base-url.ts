/**
 * Public frontend origin for OAuth return redirects and CORS.
 * Set FRONTEND_URL or CORS_ORIGIN (e.g. ngrok URL), not localhost, when testing remotely.
 */
export function getFrontendBaseUrl(): string {
  const raw =
    process.env.FRONTEND_URL?.trim() || process.env.CORS_ORIGIN?.trim();
  if (!raw) {
    return 'http://localhost:3002';
  }
  return raw.replace(/\/$/, '');
}
