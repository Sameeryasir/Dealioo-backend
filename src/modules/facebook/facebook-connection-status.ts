export const FacebookConnectionStatus = {
  INITIATED: 'INITIATED',
  AUTHENTICATED: 'AUTHENTICATED',
  TOKEN_EXCHANGED: 'TOKEN_EXCHANGED',
  AD_ACCOUNT_SELECTED: 'AD_ACCOUNT_SELECTED',
  ACTIVE: 'ACTIVE',
  SYNCING: 'SYNCING',
  FAILED: 'FAILED',
  INVALID: 'INVALID',
} as const;

export type FacebookConnectionStatusValue =
  (typeof FacebookConnectionStatus)[keyof typeof FacebookConnectionStatus];
