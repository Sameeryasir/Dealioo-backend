import { Business } from '../../db/entities/business.entity';
import { sanitizeBusinessListItem } from './sanitize-business-list-item';

describe('sanitizeBusinessListItem', () => {
  it('returns only public fields plus safe connection flags', () => {
    const business = {
      id: 155,
      name: 'test',
      slug: 'test-4',
      description: 'test',
      logoUrl: 'https://example.com/logo.jpeg',
      websiteUrl: null,
      email: 'owner@example.com',
      phoneNumber: '+10000000000',
      city: 'Islamabad / Rawalpindi',
      state: 'ACT',
      country: 'Australia',
      postalCode: '44000',
      branchCount: 1,
      onboardingCompleted: true,
      onboardingCompletedAt: new Date('2026-07-14T01:06:34.722Z'),
      stripeAccountId: 'acct_secret',
      metaUserId: '122107064775357245',
      metaAccessToken: 'EAA-secret-token',
      metaConnectedAt: new Date('2026-07-15T16:44:16.052Z'),
      metaAdAccountId: 'act_1344864057586648',
      metaConnectionStatus: 'ACTIVE',
      metaTokenExpiresAt: new Date('2026-09-12T19:23:50.052Z'),
      metaOauthScopes: 'ads_management',
      googleUserId: 'google-user',
      googleRefreshToken: 'refresh-secret',
      googleAccessToken: 'access-secret',
      createdAt: new Date('2026-07-14T01:06:22.408Z'),
      updatedAt: new Date('2026-07-15T16:44:22.295Z'),
    } as Business;

    const publicItem = sanitizeBusinessListItem(business);

    expect(publicItem).toEqual({
      id: 155,
      name: 'test',
      slug: 'test-4',
      description: 'test',
      logoUrl: 'https://example.com/logo.jpeg',
      websiteUrl: null,
      email: 'owner@example.com',
      phoneNumber: '+10000000000',
      city: 'Islamabad / Rawalpindi',
      state: 'ACT',
      country: 'Australia',
      postalCode: '44000',
      branchCount: 1,
      onboardingCompleted: true,
      onboardingCompletedAt: business.onboardingCompletedAt,
      createdAt: business.createdAt,
      updatedAt: business.updatedAt,
      stripeConnected: true,
      metaConnected: true,
    });
    expect(publicItem).not.toHaveProperty('stripeAccountId');
    expect(publicItem).not.toHaveProperty('metaUserId');
    expect(publicItem).not.toHaveProperty('metaAccessToken');
    expect(publicItem).not.toHaveProperty('metaAdAccountId');
    expect(publicItem).not.toHaveProperty('metaOauthScopes');
    expect(publicItem).not.toHaveProperty('googleRefreshToken');
  });

  it('returns false flags when integrations are missing', () => {
    const business = {
      id: 1,
      name: 'Empty',
      slug: 'empty',
      description: null,
      logoUrl: null,
      websiteUrl: null,
      email: null,
      phoneNumber: null,
      city: null,
      state: null,
      country: null,
      postalCode: null,
      branchCount: 0,
      onboardingCompleted: false,
      onboardingCompletedAt: null,
      stripeAccountId: null,
      metaUserId: null,
      metaAccessToken: null,
      metaConnectionStatus: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Business;

    const publicItem = sanitizeBusinessListItem(business);
    expect(publicItem.stripeConnected).toBe(false);
    expect(publicItem.metaConnected).toBe(false);
  });
});
