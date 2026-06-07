const MAX_QR_TOKEN_LENGTH = 512;

/** Strip unsafe characters and enforce length before DB lookup. */
export function sanitizeScanToken(raw: string): string {
  return raw
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '')
    .slice(0, MAX_QR_TOKEN_LENGTH);
}
