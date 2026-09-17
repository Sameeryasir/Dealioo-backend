import {
  normalizeTwilioSearchAreaCode,
  twilioCountrySupportsAreaCode,
} from './normalize-twilio-search-area-code';

describe('normalizeTwilioSearchAreaCode', () => {
  it('keeps a valid US area code', () => {
    expect(normalizeTwilioSearchAreaCode('US', '620')).toBe('620');
  });

  it('keeps a valid CA area code', () => {
    expect(normalizeTwilioSearchAreaCode('CA', '416')).toBe('416');
  });

  it('ignores area code for GB even if provided', () => {
    expect(normalizeTwilioSearchAreaCode('GB', '620')).toBeUndefined();
  });

  it('ignores area code for PK', () => {
    expect(normalizeTwilioSearchAreaCode('PK', '620')).toBeUndefined();
  });

  it('ignores partial area codes', () => {
    expect(normalizeTwilioSearchAreaCode('US', '6')).toBeUndefined();
    expect(normalizeTwilioSearchAreaCode('US', '62')).toBeUndefined();
  });

  it('ignores empty area code', () => {
    expect(normalizeTwilioSearchAreaCode('US', '')).toBeUndefined();
    expect(normalizeTwilioSearchAreaCode('US', null)).toBeUndefined();
  });

  it('is case-insensitive for country', () => {
    expect(normalizeTwilioSearchAreaCode('us', '620')).toBe('620');
    expect(twilioCountrySupportsAreaCode('ca')).toBe(true);
    expect(twilioCountrySupportsAreaCode('gb')).toBe(false);
  });
});
