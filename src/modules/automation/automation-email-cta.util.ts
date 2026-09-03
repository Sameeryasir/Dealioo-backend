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

function normalizeCtaLabel(label: string | undefined): string {
  return String(label ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isCompletePaymentCtaLabel(label: string | undefined): boolean {
  const normalized = normalizeCtaLabel(label);
  return (
    normalized.includes('complete payment') ||
    normalized.includes('complete your payment') ||
    normalized === 'pay now'
  );
}

export function isGoogleWalletCtaLabel(label: string | undefined): boolean {
  const normalized = normalizeCtaLabel(label);
  return (
    normalized.includes('google wallet') ||
    normalized.includes('add to wallet')
  );
}

export function isViewPassCtaLabel(label: string | undefined): boolean {
  const normalized = normalizeCtaLabel(label);
  return (
    normalized === 'view my pass' ||
    normalized === 'view your pass' ||
    normalized.includes('view my pass') ||
    normalized.includes('view your pass') ||
    isPassLinkCtaLabel(label)
  );
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
