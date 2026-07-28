export function toAiUserFacingErrorMessage(raw: string): string {
  const text = raw?.trim() || '';
  const retrySeconds = parseRetrySeconds(text);

  if (isQuotaOrRateLimitError(text)) {
    if (retrySeconds != null) {
      return `AI quota reached. Please wait about ${retrySeconds} seconds and try again.`;
    }
    return 'AI quota reached. Please wait a moment and try again.';
  }

  if (isRawProviderDump(text)) {
    return 'The AI service is temporarily unavailable. Please try again in a moment.';
  }

  if (text.length > 180) {
    return 'Something went wrong with the AI request. Please try again.';
  }

  return text || 'Something went wrong with the AI request. Please try again.';
}

function isQuotaOrRateLimitError(text: string): boolean {
  return (
    /\b429\b/.test(text) ||
    /too many requests/i.test(text) ||
    /exceeded your current quota/i.test(text) ||
    /quota exceeded/i.test(text) ||
    /rate[- ]?limit/i.test(text)
  );
}

function isRawProviderDump(text: string): boolean {
  return (
    /generativelanguage\.googleapis\.com/i.test(text) ||
    /GoogleGenerativeAI/i.test(text) ||
    /"@type"\s*:\s*"type\.googleapis\.com/i.test(text) ||
    /quotaMetric/i.test(text)
  );
}

function parseRetrySeconds(text: string): number | null {
  const retryIn = text.match(/Please retry in\s+([\d.]+)\s*s/i);
  if (retryIn?.[1]) {
    const seconds = Number(retryIn[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.max(1, Math.ceil(seconds));
    }
  }

  const retryDelay = text.match(/"retryDelay"\s*:\s*"(\d+)\s*s"/i);
  if (retryDelay?.[1]) {
    const seconds = Number(retryDelay[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.max(1, seconds);
    }
  }

  return null;
}
