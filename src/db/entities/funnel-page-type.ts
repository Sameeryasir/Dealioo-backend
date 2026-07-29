export enum FunnelPageType {
  LANDING = 'landing',
  SIGNUP = 'signup',
  PAYMENT = 'payment',
  CONFIRMATION = 'confirmation',
}

export const FUNNEL_PAGE_TYPES: readonly FunnelPageType[] = [
  FunnelPageType.LANDING,
  FunnelPageType.SIGNUP,
  FunnelPageType.PAYMENT,
  FunnelPageType.CONFIRMATION,
] as const;

export const FUNNEL_PAGE_TYPES_WITHOUT_PAYMENT: readonly FunnelPageType[] = [
  FunnelPageType.LANDING,
  FunnelPageType.SIGNUP,
  FunnelPageType.CONFIRMATION,
] as const;

export function isFunnelPageType(value: string): value is FunnelPageType {
  return (FUNNEL_PAGE_TYPES as readonly string[]).includes(value);
}
