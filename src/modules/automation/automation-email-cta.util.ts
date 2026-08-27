export function normalizeEmailLinkUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return trimmed.replace(/\/$/, '').toLowerCase();
  }
}

export function isPassLinkCtaLabel(label: string | undefined): boolean {
  return String(label ?? '')
    .trim()
    .toLowerCase() === 'pass link';
}

export function shouldShowPassLinkCta(options: {
  ctaLabel?: string;
  ctaUrl?: string;
  googleWalletSaveUrl?: string;
}): boolean {
  const label = options.ctaLabel?.trim();
  const passUrl = options.ctaUrl?.trim();
  const walletUrl = options.googleWalletSaveUrl?.trim();

  if (!label || !passUrl) {
    return false;
  }

  if (!walletUrl) {
    return true;
  }

  if (
    normalizeEmailLinkUrl(passUrl) === normalizeEmailLinkUrl(walletUrl)
  ) {
    return false;
  }

  if (isPassLinkCtaLabel(label)) {
    return false;
  }

  return true;
}
