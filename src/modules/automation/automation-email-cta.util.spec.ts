import {
  isPassLinkCtaLabel,
  normalizeEmailLinkUrl,
  shouldShowPassLinkCta,
} from './automation-email-cta.util';

describe('automation-email-cta.util', () => {
  it('normalizes email URLs for comparison', () => {
    expect(
      normalizeEmailLinkUrl('https://example.com/pass/'),
    ).toBe('https://example.com/pass');
    expect(
      normalizeEmailLinkUrl('https://Example.com/pass'),
    ).toBe('https://example.com/pass');
  });

  it('hides pass link when wallet URL matches', () => {
    expect(
      shouldShowPassLinkCta({
        ctaLabel: 'Pass Link',
        ctaUrl: 'https://dealioo.com/pass/abc',
        googleWalletSaveUrl: 'https://dealioo.com/pass/abc/',
      }),
    ).toBe(false);
  });

  it('hides pass link when wallet CTA is available for pass link label', () => {
    expect(
      shouldShowPassLinkCta({
        ctaLabel: 'Pass Link',
        ctaUrl: 'https://dealioo.com/pass/abc',
        googleWalletSaveUrl: 'https://pay.google.com/gp/v/save/jwt',
      }),
    ).toBe(false);
  });

  it('keeps non-pass-link CTAs when URLs differ', () => {
    expect(
      shouldShowPassLinkCta({
        ctaLabel: 'Complete payment',
        ctaUrl: 'https://dealioo.com/checkout/abc',
        googleWalletSaveUrl: 'https://pay.google.com/gp/v/save/jwt',
      }),
    ).toBe(true);
    expect(isPassLinkCtaLabel('Pass Link')).toBe(true);
    expect(isPassLinkCtaLabel('Complete payment')).toBe(false);
  });
});
