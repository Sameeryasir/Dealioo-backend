import { Logger } from '@nestjs/common';

const logger = new Logger('StripePayment');

export type StripePaymentLogFields = {
  phase: string;
  outcome?: string;
  paymentIntentId?: string | null;
  paymentId?: number | null;
  businessId?: number | null;
  funnelId?: number | null;
  campaignId?: number | null;
  stripeAccountId?: string | null;
  eventId?: string | null;
  eventType?: string | null;
  amount?: number | null;
  currency?: string | null;
  error?: string | null;
  [key: string]: unknown;
};

/** Structured JSON logs for Stripe payment operations (MCP Context 7). */
export function logStripePayment(fields: StripePaymentLogFields): void {
  logger.log(JSON.stringify({ scope: 'stripe_payment', ...fields }));
}

export function warnStripePayment(fields: StripePaymentLogFields): void {
  logger.warn(JSON.stringify({ scope: 'stripe_payment', ...fields }));
}

export function errorStripePayment(
  fields: StripePaymentLogFields,
  err?: unknown,
): void {
  logger.error(JSON.stringify({ scope: 'stripe_payment', ...fields }), err);
}
