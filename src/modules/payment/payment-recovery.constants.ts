export const PAYMENT_RECOVERY_QUEUE = 'payment-recovery';

export enum PaymentRecoveryJobName {
  RECOVER_PENDING = 'recover-pending-payments',
}

export const PAYMENT_RECOVERY_SCHEDULER_KEY = 'payment-pending-recovery';

export const PAYMENT_RECOVERY_INTERVAL_MS = 3 * 60 * 1000;

export const PAYMENT_RECOVERY_LOOKBACK_HOURS = 24;

export const PAYMENT_RECOVERY_BATCH_LIMIT = 50;
