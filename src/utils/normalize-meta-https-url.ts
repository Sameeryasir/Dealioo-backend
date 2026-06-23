import {
  normalizeCampaignImageUrlForMeta,
  toAbsoluteAssetUrlIfRelative,
} from './disk-file-upload-multer';
import { getFrontendBaseUrl } from './frontend-base-url';

export function normalizeMetaHttpsUrl(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) {
    return value;
  }

  const trimmed = value.trim();
  let normalized =
    normalizeCampaignImageUrlForMeta(trimmed) ??
    toAbsoluteAssetUrlIfRelative(trimmed) ??
    trimmed;

  if (normalized.startsWith('https://')) {
    return normalized;
  }

  const publicBase = getFrontendBaseUrl();
  if (publicBase.startsWith('https://')) {
    try {
      const parsed = new URL(normalized);
      if (
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1'
      ) {
        return `${publicBase}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      return normalized;
    }
  }

  return normalized;
}
