import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { Repository } from 'typeorm';
import {
  FunnelPayment,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import { CouponService } from '../redemption/coupon.service';
import { StripeService } from '../stripe/stripe.service';
import { logStripePayment, warnStripePayment } from './payment-logger';

type PaymentIntentPayload = {
  id: string;
  metadata?: Record<string, string> | null;
  last_payment_error?: { message?: string } | null;
  payment_method?: string | { id?: string } | null;
  latest_charge?: string | { id?: string; receipt_url?: string | null } | null;
};

type ChargePayload = {
  id: string;
  metadata?: Record<string, string> | null;
  payment_intent?: string | { id: string } | null;
  amount_refunded?: number;
  refunds?: { data?: Array<{ id?: string }> } | null;
  status?: string;
  receipt_url?: string | null;
};

type DisputePayload = {
  id: string;
  status: string;
  metadata?: Record<string, string> | null;
  payment_intent?: string | { id: string } | null;
  charge?: string | { id: string } | null;
};

type StripeEvent = {
  id: string;
  type: string;
  account?: string | null;
  data: { object: unknown };
};

const REUSABLE_PI_STATUSES = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
]);

@Injectable()
export class PaymentWebhookHandler {
  constructor(
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
    private readonly stripeService: StripeService,
    private readonly couponService: CouponService,
  ) {}

  async routeEvent(
    event: {
      id: string;
      type: string;
      data: { object: unknown };
    },
    connectedAccountId?: string,
  ): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(
          event.data.object as PaymentIntentPayload,
          connectedAccountId,
        );
        break;
      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentFailed(
          event.data.object as PaymentIntentPayload,
          connectedAccountId,
        );
        break;
      case 'payment_intent.canceled':
        await this.handlePaymentIntentCanceled(
          event.data.object as PaymentIntentPayload,
          connectedAccountId,
        );
        break;
      case 'charge.refunded':
        await this.handleChargeRefunded(
          event.data.object as ChargePayload,
          connectedAccountId,
        );
        break;
      case 'charge.succeeded':
      case 'charge.updated':
        await this.markFunnelPaymentPaidFromSucceededCharge(
          event.data.object as ChargePayload,
          connectedAccountId,
        );
        break;
      case 'charge.dispute.created':
      case 'charge.dispute.updated':
      case 'charge.dispute.closed':
        await this.handleDisputeEvent(
          event.type,
          event.data.object as DisputePayload,
          connectedAccountId,
        );
        break;
      default:
        logStripePayment({
          phase: 'webhook_route',
          outcome: 'no_handler',
          eventType: event.type,
          eventId: event.id,
        });
    }
  }

  resolvePaymentFromMetadata(
    metadata: Record<string, string> | null | undefined,
    paymentIntentId?: string,
  ): Promise<FunnelPayment | null> {
    const paymentIdRaw = metadata?.paymentId;
    if (paymentIdRaw) {
      const paymentId = Number.parseInt(paymentIdRaw, 10);
      if (Number.isFinite(paymentId) && paymentId > 0) {
        return this.funnelPaymentRepository.findOne({
          where: { id: paymentId },
        });
      }
    }
    if (paymentIntentId) {
      return this.funnelPaymentRepository.findOne({
        where: { stripePaymentIntentId: paymentIntentId },
      });
    }
    return Promise.resolve(null);
  }

  private async handlePaymentIntentSucceeded(
    paymentIntent: PaymentIntentPayload,
    connectedAccountId?: string,
    chargeReceiptUrl?: string,
  ) {
    const payment = await this.resolvePaymentFromMetadata(
      paymentIntent.metadata,
      paymentIntent.id,
    );

    if (!payment) {
      warnStripePayment({
        phase: 'payment_intent_succeeded',
        outcome: 'payment_not_found',
        paymentIntentId: paymentIntent.id,
        eventId: null,
      });
      return;
    }

    this.logPaymentContext('payment_intent_succeeded', payment, paymentIntent.id);

    if (payment.status === FunnelPaymentStatus.REFUNDED) {
      return;
    }

    const paymentMethodId = this.paymentMethodIdFromIntent(paymentIntent);
    const receiptUrl = await this.resolveReceiptUrl(
      paymentIntent,
      payment,
      connectedAccountId,
      chargeReceiptUrl,
    );
    const chargeId = this.chargeIdFromIntent(paymentIntent);

    await this.funnelPaymentRepository.update(payment.id, {
      status: FunnelPaymentStatus.PAID,
      paidAt: new Date(),
      stripeConnectedAccountId:
        connectedAccountId ?? payment.stripeConnectedAccountId,
      ...(chargeId ? { stripeChargeId: chargeId } : {}),
      ...(paymentMethodId ? { paymentMethod: paymentMethodId } : {}),
      ...(receiptUrl ? { receiptUrl } : {}),
    });
  }

  private async handlePaymentIntentFailed(
    paymentIntent: PaymentIntentPayload,
    connectedAccountId?: string,
  ) {
    const payment = await this.resolvePaymentFromMetadata(
      paymentIntent.metadata,
      paymentIntent.id,
    );
    if (!payment) return;

    this.logPaymentContext('payment_intent_failed', payment, paymentIntent.id);

    const failureMessage =
      paymentIntent.last_payment_error?.message ?? 'Payment failed';

    await this.funnelPaymentRepository.update(payment.id, {
      status: FunnelPaymentStatus.FAILED,
      failedAt: new Date(),
      failureReason: failureMessage,
      stripeConnectedAccountId:
        connectedAccountId ?? payment.stripeConnectedAccountId,
    });
  }

  private async handlePaymentIntentCanceled(
    paymentIntent: PaymentIntentPayload,
    connectedAccountId?: string,
  ) {
    const payment = await this.resolvePaymentFromMetadata(
      paymentIntent.metadata,
      paymentIntent.id,
    );
    if (!payment) return;

    this.logPaymentContext('payment_intent_canceled', payment, paymentIntent.id);

    await this.funnelPaymentRepository.update(payment.id, {
      status: FunnelPaymentStatus.CANCELLED,
      cancelledAt: new Date(),
      stripeConnectedAccountId:
        connectedAccountId ?? payment.stripeConnectedAccountId,
    });
  }

  private async handleChargeRefunded(
    charge: ChargePayload,
    connectedAccountId?: string,
  ) {
    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;

    const payment = await this.resolvePaymentFromMetadata(
      charge.metadata,
      paymentIntentId,
    );
    if (!payment) return;

    const refundedAmount = charge.amount_refunded ?? 0;
    const isFullRefund = refundedAmount >= payment.amount;
    const refundId = charge.refunds?.data?.[0]?.id ?? null;

    logStripePayment({
      phase: 'charge_refunded',
      paymentIntentId: paymentIntentId ?? null,
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      outcome: isFullRefund ? 'full_refund' : 'partial_refund',
    });

    await this.funnelPaymentRepository.update(payment.id, {
      status: isFullRefund
        ? FunnelPaymentStatus.REFUNDED
        : FunnelPaymentStatus.PARTIALLY_REFUNDED,
      refundedAt: new Date(),
      refundedAmount,
      stripeRefundId: refundId,
      stripeChargeId: charge.id,
      stripeConnectedAccountId:
        connectedAccountId ?? payment.stripeConnectedAccountId,
    });

    await this.couponService.syncCouponsForFunnelPayment(payment.id);
  }

  private async handleDisputeEvent(
    eventType: string,
    dispute: DisputePayload,
    connectedAccountId?: string,
  ) {
    const paymentIntentId =
      typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : dispute.payment_intent?.id;

    const payment = await this.resolvePaymentFromMetadata(
      dispute.metadata,
      paymentIntentId,
    );

    if (!payment) {
      warnStripePayment({
        phase: 'dispute_event',
        outcome: 'payment_not_found',
        eventType,
        paymentIntentId: paymentIntentId ?? null,
      });
      return;
    }

    const chargeId =
      typeof dispute.charge === 'string'
        ? dispute.charge
        : dispute.charge?.id;

    let status = payment.status;
    if (eventType === 'charge.dispute.closed') {
      status =
        dispute.status === 'won'
          ? FunnelPaymentStatus.PAID
          : FunnelPaymentStatus.REFUNDED;
    } else {
      status = FunnelPaymentStatus.DISPUTED;
    }

    logStripePayment({
      phase: 'dispute_event',
      eventType,
      paymentId: payment.id,
      paymentIntentId: paymentIntentId ?? null,
      outcome: dispute.status,
    });

    await this.funnelPaymentRepository.update(payment.id, {
      status,
      stripeDisputeId: dispute.id,
      disputeStatus: dispute.status,
      ...(chargeId ? { stripeChargeId: chargeId } : {}),
      stripeConnectedAccountId:
        connectedAccountId ?? payment.stripeConnectedAccountId,
    });

    await this.couponService.syncCouponsForFunnelPayment(payment.id);
  }

  private async markFunnelPaymentPaidFromSucceededCharge(
    charge: ChargePayload,
    connectedAccountId?: string,
  ): Promise<void> {
    if (charge.status !== 'succeeded') return;

    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;
    if (!paymentIntentId) return;

    const payment = await this.resolvePaymentFromMetadata(
      charge.metadata,
      paymentIntentId,
    );
    if (!payment) return;

    const receiptFromCharge = charge.receipt_url?.trim();
    if (receiptFromCharge && !payment.receiptUrl) {
      await this.funnelPaymentRepository.update(payment.id, {
        receiptUrl: receiptFromCharge,
        stripeChargeId: charge.id,
        stripeConnectedAccountId:
          connectedAccountId ?? payment.stripeConnectedAccountId,
      });
    }

    if (payment.status !== FunnelPaymentStatus.PENDING) return;

    await this.handlePaymentIntentSucceeded(
      { id: paymentIntentId, metadata: charge.metadata } as PaymentIntentPayload,
      connectedAccountId,
      receiptFromCharge,
    );
  }

  private paymentMethodIdFromIntent(
    pi: PaymentIntentPayload,
  ): string | undefined {
    const pm = pi.payment_method;
    if (!pm) return undefined;
    if (typeof pm === 'string') return pm;
    if (typeof pm === 'object' && pm && 'id' in pm) {
      return (pm as { id?: string }).id;
    }
    return undefined;
  }

  private receiptUrlFromIntent(pi: PaymentIntentPayload): string | undefined {
    const lc = pi.latest_charge;
    if (lc && typeof lc === 'object' && 'receipt_url' in lc) {
      const url =
        typeof lc === 'object' && lc && 'receipt_url' in lc
          ? (lc as { receipt_url?: string | null }).receipt_url
          : undefined;
      if (url) return url;
    }
    return undefined;
  }

  private chargeIdFromIntent(pi: PaymentIntentPayload): string | undefined {
    const lc = pi.latest_charge;
    if (typeof lc === 'string') return lc;
    if (lc && typeof lc === 'object' && 'id' in lc) {
      return typeof lc === 'object' && lc && 'id' in lc
        ? (lc as { id: string }).id
        : undefined;
    }
    return undefined;
  }

  private async resolveReceiptUrl(
    paymentIntent: PaymentIntentPayload,
    payment: FunnelPayment,
    connectedAccountId?: string,
    chargeReceiptUrl?: string,
  ): Promise<string | undefined> {
    const fromWebhook =
      chargeReceiptUrl?.trim() ||
      this.receiptUrlFromIntent(paymentIntent) ||
      payment.receiptUrl?.trim();
    if (fromWebhook) return fromWebhook;

    const accountId =
      connectedAccountId ?? payment.stripeConnectedAccountId?.trim();
    if (!accountId || !paymentIntent.id) return undefined;

    try {
      const stripe = this.stripeService.clientForConnectedAccount(accountId);
      const pi = await stripe.paymentIntents.retrieve(paymentIntent.id, {
        expand: ['latest_charge'],
      });
      const latest = pi.latest_charge;
      if (latest && typeof latest === 'object' && latest.receipt_url) {
        return latest.receipt_url.trim() || undefined;
      }
    } catch {
      warnStripePayment({
        phase: 'receipt_url_fetch',
        outcome: 'failed',
        paymentIntentId: paymentIntent.id,
        paymentId: payment.id,
      });
    }
    return undefined;
  }

  private logPaymentContext(
    phase: string,
    payment: FunnelPayment,
    paymentIntentId: string,
  ) {
    logStripePayment({
      phase,
      paymentId: payment.id,
      paymentIntentId,
      restaurantId: payment.restaurantId,
      funnelId: payment.funnelId,
      campaignId: payment.campaignId,
      stripeAccountId: payment.stripeConnectedAccountId,
      amount: payment.amount,
      currency: payment.currency,
    });
  }

  /** Reusable pending checkout window (hours). */
  static readonly PENDING_REUSE_HOURS = 24;

  static isReusablePaymentIntentStatus(status: string): boolean {
    return REUSABLE_PI_STATUSES.has(status);
  }
}
