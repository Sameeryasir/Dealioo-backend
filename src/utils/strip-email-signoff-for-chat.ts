const URL_PATTERN = /https?:\/\/\S+/gi;

const PAYMENT_CTA_LINE_PATTERN =
  /^(complete payment|complete your payment|pay now|tap the link below)\b/i;

const PASS_CTA_LINE_PATTERN =
  /^(View my pass|View your pass|View your pass online|Add to Google Wallet|Open link)\s*:\s*https?:\/\/\S+/i;

/** Removes email sign-off so chat previews stay short and consistent. */
export function stripEmailSignoffForChat(text: string): string {
  return text.replace(/\n*Best regards,\s*\nDealioo Team\s*$/i, '').trim();
}

/**
 * Removes customer-specific URLs from owner-facing guest chat.
 * Keeps a plain label (e.g. "View my pass") so staff know a pass was sent,
 * without exposing the guest's personal link.
 */
export function stripAutomationLinksForChat(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cleaned: string[] = [];

  for (const rawLine of lines) {
    const trimmedRaw = rawLine.trim();

    if (PASS_CTA_LINE_PATTERN.test(trimmedRaw)) {
      const label = trimmedRaw.replace(/:\s*https?:\/\/\S+/i, '').trim();
      if (label) cleaned.push(label);
      continue;
    }

    const withoutUrls = rawLine.replace(URL_PATTERN, '').trimEnd();
    const trimmed = withoutUrls.trim();

    if (!trimmed) {
      if (cleaned.length > 0 && cleaned[cleaned.length - 1] !== '') {
        cleaned.push('');
      }
      continue;
    }

    if (PAYMENT_CTA_LINE_PATTERN.test(trimmed)) {
      continue;
    }

    cleaned.push(withoutUrls);
  }

  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Full chat-body sanitizer used when saving and returning guest messages. */
export function sanitizeChatMessageBody(body: string): string {
  const normalized = stripAutomationLinksForChat(
    stripEmailSignoffForChat(body),
  );
  return normalized || 'Message sent';
}
