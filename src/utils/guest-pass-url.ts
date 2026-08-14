import { getFrontendBaseUrl } from './frontend-base-url';

export function buildGuestPassUrl(accessToken: string): string {
  const token = accessToken.trim();
  return `${getFrontendBaseUrl()}/pass/${encodeURIComponent(token)}`;
}
