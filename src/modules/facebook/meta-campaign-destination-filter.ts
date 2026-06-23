import { getFrontendBaseUrl } from '../../utils/frontend-base-url';

export function isNgrokHostname(hostname: string): boolean {
  return (
    hostname.endsWith('.ngrok-free.app') ||
    hostname.endsWith('.ngrok-free.dev') ||
    hostname.endsWith('.ngrok.io') ||
    hostname.endsWith('.ngrok.app')
  );
}

export function resolveExpectedCampaignLandingUrl(
  websiteUrl?: string | null,
): string | null {
  const candidates = [
    websiteUrl?.trim(),
    process.env.FRONTEND_URL?.trim(),
    process.env.PUBLIC_BASE_URL?.trim(),
    getFrontendBaseUrl(),
  ].filter((value): value is string => Boolean(value?.trim()));

  for (const raw of candidates) {
    try {
      const normalized = raw.replace(/\/$/, '');
      if (
        normalized.startsWith('https://') ||
        normalized.startsWith('http://')
      ) {
        return normalized;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function normalizeUrlForComparison(url: string): string {
  try {
    const parsed = new URL(url.trim());
    const path = parsed.pathname.replace(/\/$/, '') || '';
    return `${parsed.origin}${path}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase().replace(/\/$/, '');
  }
}

export function destinationUrlMatchesCampaignLanding(
  adDestinationUrl: string,
  expectedLanding: string,
): boolean {
  try {
    const ad = new URL(adDestinationUrl.trim());
    const expected = new URL(expectedLanding.trim());

    if (ad.origin.toLowerCase() !== expected.origin.toLowerCase()) {
      return false;
    }

    const adKey = normalizeUrlForComparison(ad.href);
    const expectedKey = normalizeUrlForComparison(expected.href);

    if (adKey === expectedKey) {
      return true;
    }

    const expectedPath =
      expected.pathname.replace(/\/$/, '') || '/';
    const adPath = ad.pathname.replace(/\/$/, '') || '/';

    if (expectedPath === '/') {
      return true;
    }

    return (
      adPath === expectedPath || adPath.startsWith(`${expectedPath}/`)
    );
  } catch {
    return false;
  }
}

export type MetaCreativeLinkPayload = {
  link_url?: string;
  object_story_spec?: {
    link_data?: {
      link?: string;
      child_attachments?: Array<{ link?: string }>;
    };
    video_data?: {
      call_to_action?: { value?: { link?: string } };
    };
  };
  asset_feed_spec?: { link_urls?: string[] };
};

export function extractCreativeDestinationUrl(
  creative: MetaCreativeLinkPayload | undefined | null,
): string | null {
  if (!creative) {
    return null;
  }

  if (creative.link_url?.trim()) {
    return creative.link_url.trim();
  }

  const linkData = creative.object_story_spec?.link_data;
  if (linkData?.link?.trim()) {
    return linkData.link.trim();
  }

  const carouselLink = linkData?.child_attachments?.[0]?.link?.trim();
  if (carouselLink) {
    return carouselLink;
  }

  const videoLink =
    creative.object_story_spec?.video_data?.call_to_action?.value?.link?.trim();
  if (videoLink) {
    return videoLink;
  }

  const feedLink = creative.asset_feed_spec?.link_urls?.[0]?.trim();
  if (feedLink) {
    return feedLink;
  }

  return null;
}
