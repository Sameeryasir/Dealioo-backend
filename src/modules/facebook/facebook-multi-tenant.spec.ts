import { createHmac } from 'crypto';
import {
  createFacebookOAuthState,
  parseFacebookOAuthState,
} from './facebook-oauth-state';
import {
  extractBusinessFacebookCredentials,
  requireBusinessFacebookCredentials,
} from './business-facebook-credentials';

describe('facebook-oauth-state', () => {
  const secret = 'test-app-secret';

  it('embeds business id in signed state and parses it back', () => {
    const state = createFacebookOAuthState(42, secret);
    expect(parseFacebookOAuthState(state, secret)).toBe(42);
  });

  it('rejects tampered state', () => {
    const state = createFacebookOAuthState(42, secret);
    const tampered = state.replace('42', '99');
    expect(() => parseFacebookOAuthState(tampered, secret)).toThrow(
      'Invalid Facebook OAuth state signature.',
    );
  });

  it('rejects expired state', () => {
    const timestamp = Date.now() - 2 * 60 * 60 * 1000;
    const payload = `42.${timestamp}`;
    const signature = createHmac('sha256', secret)
      .update(payload)
      .digest('hex')
      .slice(0, 32);
    const expiredState = `${payload}.${signature}`;

    expect(() => parseFacebookOAuthState(expiredState, secret)).toThrow(
      'Facebook OAuth state expired',
    );
  });
});

describe('business-facebook-credentials', () => {
  const baseBusiness = {
    id: 7,
    metaUserId: 'fb-user-a',
    metaAccessToken: 'token-a',
    metaAdAccountId: 'act_111',
  } as Parameters<typeof extractBusinessFacebookCredentials>[0];

  it('extracts credentials only from the given business row', () => {
    const credentials = extractBusinessFacebookCredentials(baseBusiness);
    expect(credentials).toEqual({
      businessId: 7,
      facebookUserId: 'fb-user-a',
      accessToken: 'token-a',
      adAccountId: 'act_111',
    });
  });

  it('returns null when business has no token', () => {
    expect(
      extractBusinessFacebookCredentials({
        ...baseBusiness,
        metaAccessToken: null,
      }),
    ).toBeNull();
  });

  it('throws when credentials are required but missing', () => {
    expect(() =>
      requireBusinessFacebookCredentials({
        ...baseBusiness,
        metaUserId: null,
      }),
    ).toThrow('Facebook is not connected');
  });
});
