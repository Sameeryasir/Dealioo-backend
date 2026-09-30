import {
  createStripeOAuthState,
  parseStripeOAuthState,
  peekStripeOAuthStateBusinessId,
} from './stripe-oauth-state';

describe('stripe-oauth-state', () => {
  const secret = 'test-stripe-oauth-secret';

  it('round-trips a signed business id', () => {
    const state = createStripeOAuthState(42, secret);
    expect(parseStripeOAuthState(state, secret)).toBe(42);
  });

  it('rejects tampered state', () => {
    const state = createStripeOAuthState(42, secret);
    const tampered = state.replace(/^42/, '99');
    expect(() => parseStripeOAuthState(tampered, secret)).toThrow(
      /signature/i,
    );
  });

  it('rejects bare businessId state', () => {
    expect(() => parseStripeOAuthState('42', secret)).toThrow(/Invalid/i);
  });

  it('peeks business id without requiring TTL', () => {
    const state = createStripeOAuthState(7, secret);
    expect(peekStripeOAuthStateBusinessId(state, secret)).toBe(7);
  });
});
