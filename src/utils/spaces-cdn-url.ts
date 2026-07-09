/** Rewrites origin Spaces URLs to the CDN edge (faster global delivery). */
export function toDigitalOceanSpacesCdnUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed || !trimmed.includes('digitaloceanspaces.com')) {
    return trimmed;
  }
  if (trimmed.includes('.cdn.digitaloceanspaces.com')) {
    return trimmed;
  }

  const cdnBase =
    process.env.DO_SPACES_CDN_URL?.trim()?.replace(/\/$/, '') ??
    process.env.NEXT_PUBLIC_DO_SPACES_CDN_URL?.trim()?.replace(/\/$/, '');

  if (cdnBase) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.hostname.includes('digitaloceanspaces.com')) {
        return `${cdnBase}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      // fall through to hostname swap
    }
  }

  return trimmed.replace(
    /\.digitaloceanspaces\.com/i,
    '.cdn.digitaloceanspaces.com',
  );
}

export function resolveDigitalOceanSpacesPublicBaseUrl(
  bucket: string,
  region: string,
  endpointFromEnv?: string,
): string {
  const cdnOverride =
    process.env.DO_SPACES_CDN_URL?.trim()?.replace(/\/$/, '') ?? '';

  if (cdnOverride) {
    return cdnOverride;
  }

  const origin = endpointFromEnv?.trim()?.replace(/\/$/, '')
    ? endpointFromEnv.trim().replace(/\/$/, '')
    : `https://${bucket}.${region}.digitaloceanspaces.com`;

  if (origin.includes('.cdn.digitaloceanspaces.com')) {
    return origin;
  }

  if (origin.includes('.digitaloceanspaces.com')) {
    return origin.replace(
      /\.digitaloceanspaces\.com/i,
      '.cdn.digitaloceanspaces.com',
    );
  }

  return origin;
}
