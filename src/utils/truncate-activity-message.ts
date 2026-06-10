export function truncateActivityMessagePreview(
  raw: string,
  maxLength = 120,
): string {
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'Text sent';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const sentenceEnd = normalized.search(/[.!?](?:\s|$)/);
  if (sentenceEnd > 0 && sentenceEnd < maxLength) {
    return normalized.slice(0, sentenceEnd + 1).trim();
  }

  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}
