export const ACTIVITY_PAYMENT_PLACE = {
  ONLINE: 'ONLINE',
  IN_STORE: 'IN_STORE',
} as const;

export type ActivityPaymentPlace =
  (typeof ACTIVITY_PAYMENT_PLACE)[keyof typeof ACTIVITY_PAYMENT_PLACE];

export function resolveActivityPaymentPlace(input: {
  isInStore: boolean;
}): ActivityPaymentPlace {
  return input.isInStore
    ? ACTIVITY_PAYMENT_PLACE.IN_STORE
    : ACTIVITY_PAYMENT_PLACE.ONLINE;
}
