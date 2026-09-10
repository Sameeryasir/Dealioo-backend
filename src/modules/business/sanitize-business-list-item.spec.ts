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
      businessType: null,
      currency: null,
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
      googleConnectionStatus: 'ACTIVE',
      twilioPhoneSid: 'PN123',
      twilioPhoneNumber: '+15551234567',
      createdAt: new Date('2026-07-14T01:06:22.408Z'),
      updatedAt: new Date('2026-07-15T16:44:22.295Z'),
      owner: { id: 9 },
    } as Business;

    const publicItem = sanitizeBusinessListItem(business, {
      viewerUserId: 9,
    });

    expect(publicItem).toMatchObject({
      id: 155,
      name: 'test',
      slug: 'test-4',
      description: 'test',
      logoUrl: 'https://example.com/logo.jpeg',
      businessType: null,
      currency: null,
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
      googleAdsConnected: true,
      twilioConnected: true,
      twilioPhoneNumber: '+15551234567',
      isOwner: true,
    });
    expect(publicItem.setupProgressPercent).toBe(100);
    expect(publicItem).not.toHaveProperty('stripeAccountId');
    expect(publicItem).not.toHaveProperty('metaUserId');
    expect(publicItem).not.toHaveProperty('metaAccessToken');
    expect(publicItem).not.toHaveProperty('metaAdAccountId');
    expect(publicItem).not.toHaveProperty('metaOauthScopes');
    expect(publicItem).not.toHaveProperty('googleRefreshToken');
    expect(publicItem).not.toHaveProperty('twilioPhoneSid');
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
      googleUserId: null,
      googleRefreshToken: null,
      googleConnectionStatus: null,
      twilioPhoneSid: null,
      twilioPhoneNumber: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Business;

    const publicItem = sanitizeBusinessListItem(business);
    expect(publicItem.stripeConnected).toBe(false);
    expect(publicItem.metaConnected).toBe(false);
    expect(publicItem.googleAdsConnected).toBe(false);
    expect(publicItem.twilioConnected).toBe(false);
    expect(publicItem.twilioPhoneNumber).toBeNull();
    expect(publicItem.isOwner).toBe(false);
  });

  it('falls back to Untitled business without scoring the name as complete', () => {
    const business = {
      id: 3,
      name: '   ',
      slug: '',
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
      googleUserId: null,
      googleRefreshToken: null,
      googleConnectionStatus: null,
      twilioPhoneSid: null,
      twilioPhoneNumber: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Business;

    const publicItem = sanitizeBusinessListItem(business);
    expect(publicItem.name).toBe('Untitled business');
    expect(publicItem.slug).toBe('business-3');
    expect(publicItem.setupProgressPercent).toBe(0);
  });

  it('does not treat a Meta user id or Twilio number alone as connected', () => {
    const business = {
      id: 2,
      name: 'Partial',
      slug: 'partial',
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
      onboardingCompleted: true,
      onboardingCompletedAt: new Date(),
      stripeAccountId: null,
      metaUserId: '122107064775357245',
      metaAccessToken: null,
      metaAdAccountId: null,
      metaConnectionStatus: 'AUTHENTICATED',
      twilioPhoneSid: null,
      twilioPhoneNumber: '+15551234567',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Business;

    const publicItem = sanitizeBusinessListItem(business);
    expect(publicItem.metaConnected).toBe(false);
    expect(publicItem.twilioConnected).toBe(false);
    expect(publicItem.twilioPhoneNumber).toBe('+15551234567');
  });
});
