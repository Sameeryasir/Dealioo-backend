const HTTPS_URL_RE = /^https:\/\/[^\s]+$/i;

export function sanitizeAutomationTagName(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 64);
}

export function sanitizeHttpsUrl(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  if (!value || !HTTPS_URL_RE.test(value)) {
    return null;
  }
  return value.slice(0, 2048);
}

export function resolveTagActionMode(
  config: Record<string, unknown>,
): 'tag' | 'ask_review' | 'bundled' | 'prepaid' {
  const workflowKind = String(config.workflowKind ?? '').trim();
  if (workflowKind === 'prepaid_payment_actions') return 'prepaid';
  if (workflowKind === 'actions') return 'bundled';
  const action = String(config.action ?? '').trim().toLowerCase();
  if (action === 'ask_review' || workflowKind === 'ask_review') {
    return 'ask_review';
  }
  return 'tag';
}
