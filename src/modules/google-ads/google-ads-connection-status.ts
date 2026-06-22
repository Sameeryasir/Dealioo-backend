export const GoogleAdsConnectionStatus = {
  INITIATED: 'INITIATED',
  AUTHENTICATED: 'AUTHENTICATED',
  TOKEN_EXCHANGED: 'TOKEN_EXCHANGED',
  CUSTOMER_SELECTED: 'CUSTOMER_SELECTED',
  ACTIVE: 'ACTIVE',
  SYNCING: 'SYNCING',
  FAILED: 'FAILED',
} as const;

export type GoogleAdsConnectionStatusValue =
  (typeof GoogleAdsConnectionStatus)[keyof typeof GoogleAdsConnectionStatus];
