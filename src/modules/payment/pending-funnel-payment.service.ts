import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { CampaignType } from '../../db/entities/campaign.entity';
import {
  FunnelCollectionChannel,
  FunnelPayment,
  FunnelPaymentMethod,
  FunnelPaymentSource,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import {
  Order,
  OrderSource,
  OrderStatus,
} from '../../db/entities/order.entity';
import { logStripePayment } from './payment-logger';

export type EnsurePendingFunnelPaymentInput = {
  funnelId: number;
  businessId: number;
  campaignId: number;
  customerId: number | null;
  customerEmail: string;
  amountCents: number;
  currency?: string;
  campaignType?: CampaignType | string | null;
  stripeConnectedAccountId?: string | null;
  platformFeeAmount?: number;
};

@Injectable()
export class PendingFunnelPaymentService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async ensurePendingPayment(
    input: EnsurePendingFunnelPaymentInput,
  ): Promise<FunnelPayment> {
    const email = input.customerEmail.trim().toLowerCase();
    const currency = (input.currency || 'usd').trim().toLowerCase() || 'usd';
    const [lockKey1, lockKey2] = this.guestLockKeys(
      input.businessId,
      input.funnelId,
      email,
    );

    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [
        lockKey1,
        lockKey2,
      ]);

      // Paid rows stay as completed purchases. Unpaid rows are reused so a
      // second funnel signup updates the open checkout instead of stacking copies.
      const pending = await manager.findOne(FunnelPayment, {
        where: {
          funnelId: input.funnelId,
          businessId: input.businessId,
          customerEmail: email,
          status: In([
            FunnelPaymentStatus.PENDING,
            FunnelPaymentStatus.FAILED,
            FunnelPaymentStatus.CANCELLED,
          ]),
        },
        order: { createdAt: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });

      if (pending) {
        await this.updateExistingPending(manager, pending, {
          ...input,
          customerEmail: email,
          currency,
        });
        logStripePayment({
          phase: 'pending_payment_ensure',
          outcome: 'reuse_pending_payment',
          paymentId: pending.id,
          checkoutSessionId: pending.stripeCheckoutSessionId,
        });
        return pending;
      }

      const created = await this.createPendingWithOrder(manager, {
        ...input,
        customerEmail: email,
        currency,
      });
      logStripePayment({
        phase: 'pending_payment_ensure',
        outcome: 'created_pending_payment',
        paymentId: created.id,
      });
      return created;
    });
  }

  private guestLockKeys(
    businessId: number,
    funnelId: number,
    customerEmail: string,
  ): [number, number] {
    let hash = 2166136261;
    for (let i = 0; i < customerEmail.length; i += 1) {
      hash ^= customerEmail.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const key1 = (Math.imul(businessId, 1_000_003) + funnelId) | 0;
    const key2 = hash | 0;
    return [key1, key2];
  }

  private resolveProvenance(campaignType: CampaignType | string | null | undefined) {
    const isPostpaid =
      String(campaignType ?? '').toLowerCase() === CampaignType.POSTPAID;
    if (isPostpaid) {
      return {
        paymentSource: FunnelPaymentSource.MANUAL,
        collectionChannel: FunnelCollectionChannel.IN_STORE,
        paymentMethod: FunnelPaymentMethod.OTHER,
        orderSource: OrderSource.MANUAL,
        isPostpaid: true as const,
      };
    }
    return {
      paymentSource: FunnelPaymentSource.STRIPE,
      collectionChannel: FunnelCollectionChannel.ONLINE,
      paymentMethod: FunnelPaymentMethod.ONLINE_CARD,
      orderSource: OrderSource.STRIPE,
      isPostpaid: false as const,
    };
  }

  private async updateExistingPending(
    manager: EntityManager,
    payment: FunnelPayment,
    input: EnsurePendingFunnelPaymentInput & {
      customerEmail: string;
      currency: string;
    },
  ): Promise<void> {
    const now = new Date();
    const provenance = this.resolveProvenance(input.campaignType);
    const hasStripeLink = Boolean(
      payment.stripePaymentIntentId?.trim() ||
        payment.stripeCheckoutSessionId?.trim(),
    );
    const shouldHealProvenance = provenance.isPostpaid && !hasStripeLink;
    const amountCents =
      input.amountCents > 0 ? input.amountCents : (payment.amount ?? 0);

    const patch: {
      updatedAt: Date;
      status?: FunnelPaymentStatus;
      cancelledAt?: Date | null;
      stripeCheckoutSessionId?: string | null;
      stripePaymentIntentId?: string | null;
      campaignId?: number | null;
      customerId?: number | null;
      amount?: number;
      currency?: string;
      stripeConnectedAccountId?: string | null;
      platformFeeAmount?: number;
      paymentSource?: FunnelPaymentSource;
      collectionChannel?: FunnelCollectionChannel;
      paymentMethod?: FunnelPaymentMethod;
    } = {
      updatedAt: now,
      campaignId: payment.campaignId ?? input.campaignId,
    };

    if (payment.status !== FunnelPaymentStatus.PENDING) {
      patch.status = FunnelPaymentStatus.PENDING;
      patch.cancelledAt = null;
      patch.stripeCheckoutSessionId = null;
      patch.stripePaymentIntentId = null;
      payment.status = FunnelPaymentStatus.PENDING;
      payment.cancelledAt = null;
      payment.stripeCheckoutSessionId = null;
      payment.stripePaymentIntentId = null;
    }

    if (input.customerId != null && payment.customerId !== input.customerId) {
      patch.customerId = input.customerId;
      payment.customerId = input.customerId;
    }
    if (amountCents > 0 && amountCents !== payment.amount) {
      patch.amount = amountCents;
      payment.amount = amountCents;
    }
    if (input.currency && input.currency !== payment.currency) {
      patch.currency = input.currency;
      payment.currency = input.currency;
    }
    if (
      input.stripeConnectedAccountId != null &&
      input.stripeConnectedAccountId.trim()
    ) {
      patch.stripeConnectedAccountId = input.stripeConnectedAccountId.trim();
      payment.stripeConnectedAccountId = patch.stripeConnectedAccountId;
    }
    if (
      input.platformFeeAmount != null &&
      input.platformFeeAmount >= 0 &&
      input.platformFeeAmount !== payment.platformFeeAmount
    ) {
      patch.platformFeeAmount = input.platformFeeAmount;
      payment.platformFeeAmount = input.platformFeeAmount;
    }
    if (shouldHealProvenance) {
      patch.paymentSource = provenance.paymentSource;
      patch.collectionChannel = provenance.collectionChannel;
      patch.paymentMethod = provenance.paymentMethod;
      payment.paymentSource = provenance.paymentSource;
      payment.collectionChannel = provenance.collectionChannel;
      payment.paymentMethod = provenance.paymentMethod;
    }

    await manager.update(FunnelPayment, payment.id, patch);
    payment.updatedAt = now;
    if (patch.campaignId != null) {
      payment.campaignId = patch.campaignId;
    }

    await this.ensureOrderForPayment(manager, payment, {
      orderSource: shouldHealProvenance
        ? provenance.orderSource
        : undefined,
      amountCents: payment.amount,
      currency: payment.currency || input.currency,
      businessId: input.businessId,
    });
  }

  private async createPendingWithOrder(
    manager: EntityManager,
    input: EnsurePendingFunnelPaymentInput & {
      customerEmail: string;
      currency: string;
    },
  ): Promise<FunnelPayment> {
    const provenance = this.resolveProvenance(input.campaignType);
    const amount = input.amountCents > 0 ? input.amountCents : 0;

    const payment = await manager.save(
      manager.create(FunnelPayment, {
        funnelId: input.funnelId,
        businessId: input.businessId,
        campaignId: input.campaignId,
        customerId: input.customerId,
        customerEmail: input.customerEmail,
        amount,
        currency: input.currency,
        platformFeeAmount: input.platformFeeAmount ?? 0,
        status: FunnelPaymentStatus.PENDING,
        paymentSource: provenance.paymentSource,
        collectionChannel: provenance.collectionChannel,
        paymentMethod: provenance.paymentMethod,
        stripeConnectedAccountId:
          input.stripeConnectedAccountId?.trim() || null,
        stripePaymentIntentId: null,
        stripeCheckoutSessionId: null,
        refundedAmount: 0,
        orderId: null,
      }),
    );

    await this.ensureOrderForPayment(manager, payment, {
      orderSource: provenance.orderSource,
      amountCents: amount,
      currency: input.currency,
      businessId: input.businessId,
    });

    return payment;
  }

  private async ensureOrderForPayment(
    manager: EntityManager,
    payment: FunnelPayment,
    opts: {
      businessId: number;
      amountCents: number;
      currency: string;
      orderSource?: OrderSource;
    },
  ): Promise<void> {
    const now = new Date();

    if (payment.orderId != null) {
      const orderPatch: {
        updatedAt: Date;
        totalAmount?: number;
        source?: OrderSource;
      } = { updatedAt: now };
      if (opts.amountCents > 0) {
        orderPatch.totalAmount = opts.amountCents;
      }
      if (opts.orderSource) {
        orderPatch.source = opts.orderSource;
      }
      if (Object.keys(orderPatch).length > 1) {
        await manager.update(Order, payment.orderId, orderPatch);
      }
      return;
    }

    const order = await manager.save(
      manager.create(Order, {
        businessId: opts.businessId,
        status: OrderStatus.PENDING,
        source: opts.orderSource ?? OrderSource.STRIPE,
        totalAmount: opts.amountCents > 0 ? opts.amountCents : payment.amount,
        currency: opts.currency || payment.currency || 'usd',
        paidAt: null,
      }),
    );

    await manager.update(FunnelPayment, payment.id, { orderId: order.id });
    payment.orderId = order.id;
  }
}
