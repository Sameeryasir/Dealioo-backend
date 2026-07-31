import { google } from 'googleapis';
import type { Credentials } from 'google-auth-library';

export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/adwords',
  'openid',
  'email',
  'profile',
] as const;

export function createGoogleOAuth2Client(redirectUri?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured.');
  }
  if (!clientSecret) {
    throw new Error('GOOGLE_CLIENT_SECRET is not configured.');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function buildGoogleOAuthConnectUrl(input: {
  redirectUri: string;
  state: string;
}): string {
  const client = createGoogleOAuth2Client(input.redirectUri);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account',
    scope: [...GOOGLE_OAUTH_SCOPES],
    state: input.state,
    include_granted_scopes: true,
  });
}

export async function exchangeGoogleAuthCode(input: {
  code: string;
  redirectUri: string;
}): Promise<Credentials> {
  const client = createGoogleOAuth2Client(input.redirectUri);
  const { tokens } = await client.getToken(input.code);
  return tokens;
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<Credentials> {
  const client = createGoogleOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  return credentials;
}

export async function fetchGoogleOAuthUserInfo(accessToken: string): Promise<{
  id: string | null;
  email: string | null;
}> {
  const client = createGoogleOAuth2Client();
  client.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();
  return {
    id: data.id?.trim() || null,
    email: data.email?.trim() || null,
  };
}
