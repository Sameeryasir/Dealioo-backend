import { getFrontendBaseUrl } from './frontend-base-url';

export function buildCampaignFeedbackUrl(token: string): string {
  const safe = token.trim();
  return `${getFrontendBaseUrl()}/feedback/${encodeURIComponent(safe)}`;
}
