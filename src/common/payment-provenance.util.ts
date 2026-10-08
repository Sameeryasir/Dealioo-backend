import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { FunnelEventType } from '../db/entities/funnel-event.entity';
import {
  FunnelCollectionChannel,
  FunnelPayment,
  FunnelPaymentSource,
} from '../db/entities/funnel-payment.entity';

export type GuestDealPaymentBadge =
  | 'PAID_ONLINE'
  | 'PAID_AT_COUNTER'
  | 'PENDING';

export function applyCampaignFunnelPaymentOriginFilter<
  T extends ObjectLiteral,
>(qb: SelectQueryBuilder<T>, alias = 'payment'): SelectQueryBuilder<T> {
  return qb.andWhere(
    `(
      ${alias}.payment_source IN (:...campaignFunnelPaymentSources)
      OR ${alias}.collection_channel = :campaignFunnelOnlineChannel
      OR ${alias}.stripe_payment_intent_id IS NOT NULL
      OR ${alias}.stripe_checkout_session_id IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM funnel_event fe_campaign_signup
        WHERE fe_campaign_signup.funnel_id = ${alias}.funnel_id
          AND fe_campaign_signup.customer_id IS NOT NULL
          AND fe_campaign_signup.customer_id = ${alias}.customer_id
          AND fe_campaign_signup.event_type = :campaignFunnelSignupEvent
          AND fe_campaign_signup.deleted_at IS NULL
      )
    )`,
    {
      campaignFunnelPaymentSources: [
        FunnelPaymentSource.STRIPE,
        FunnelPaymentSource.MANUAL,
      ],
      campaignFunnelOnlineChannel: FunnelCollectionChannel.ONLINE,
      campaignFunnelSignupEvent: FunnelEventType.SIGNUP,
    },
  );
}

export function isOnlineFunnelPayment(
  payment: FunnelPayment | null | undefined,
): boolean {
  if (!payment) {
    return false;
  }

  if (payment.paymentSource === FunnelPaymentSource.SCANNER) {
    return false;
  }
  if (payment.collectionChannel === FunnelCollectionChannel.IN_STORE) {
    return false;
  }

  if (payment.paymentSource === FunnelPaymentSource.STRIPE) {
    return true;
  }
  if (payment.collectionChannel === FunnelCollectionChannel.ONLINE) {
    return true;
  }
  return (
    Boolean(payment.stripePaymentIntentId?.trim()) ||
    Boolean(payment.stripeCheckoutSessionId?.trim())
  );
}

export function isScannerFunnelPayment(
  payment: FunnelPayment | null | undefined,
): boolean {
  if (!payment) {
    return false;
  }
  if (payment.paymentSource === FunnelPaymentSource.SCANNER) {
    return true;
  }
  if (payment.collectionChannel === FunnelCollectionChannel.IN_STORE) {
    return true;
  }
  return false;
}

export function resolveGuestDealPaymentBadge(params: {
  couponPaid: boolean;
  payment: FunnelPayment | null | undefined;
}): GuestDealPaymentBadge {
  if (!params.couponPaid) {
    return 'PENDING';
  }
  if (isScannerFunnelPayment(params.payment)) {
    return 'PAID_AT_COUNTER';
  }
  if (isOnlineFunnelPayment(params.payment)) {
    return 'PAID_ONLINE';
  }
  return 'PAID_AT_COUNTER';
}
