import { createHmac } from 'crypto';
import {
  createFacebookOAuthState,
  parseFacebookOAuthState,
} from './facebook-oauth-state';
import {
  extractRestaurantFacebookCredentials,
  requireRestaurantFacebookCredentials,
} from './restaurant-facebook-credentials';

describe('facebook-oauth-state', () => {
  const secret = 'test-app-secret';

  it('embeds restaurant id in signed state and parses it back', () => {
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

describe('restaurant-facebook-credentials', () => {
  const baseRestaurant = {
    id: 7,
    metaUserId: 'fb-user-a',
    metaAccessToken: 'token-a',
    metaAdAccountId: 'act_111',
  } as Parameters<typeof extractRestaurantFacebookCredentials>[0];

  it('extracts credentials only from the given restaurant row', () => {
    const credentials = extractRestaurantFacebookCredentials(baseRestaurant);
    expect(credentials).toEqual({
      restaurantId: 7,
      facebookUserId: 'fb-user-a',
      accessToken: 'token-a',
      adAccountId: 'act_111',
    });
  });

  it('returns null when restaurant has no token', () => {
    expect(
      extractRestaurantFacebookCredentials({
        ...baseRestaurant,
        metaAccessToken: null,
      }),
    ).toBeNull();
  });

  it('throws when credentials are required but missing', () => {
    expect(() =>
      requireRestaurantFacebookCredentials({
        ...baseRestaurant,
        metaUserId: null,
      }),
    ).toThrow('Facebook is not connected');
  });
});
