import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  FunnelCollectionChannel,
  FunnelPayment,
  FunnelPaymentSource,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import {
  Order,
  OrderSource,
  OrderStatus,
} from '../../db/entities/order.entity';
import { Customer } from '../../db/entities/customer.entity';
import { ActivityService } from '../activity/activity.service';
import { CustomerActivityService } from '../customer-activity/customer-activity.service';
import { FunnelEventService } from '../funnel-event/funnel-event.service';
import { logStripePayment, warnStripePayment } from './payment-logger';

export type PaymentFinalizeSource =
  | 'webhook'
  | 'status_sync'
  | 'manual_sync'
  | 'checkout_reuse'
  | 'recovery';

export type FinalizeSuccessfulPaymentInput = {
  paymentId: number;
  source: PaymentFinalizeSource;
  webhookEventId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripeConnectedAccountId?: string | null;
  stripeChargeId?: string | null;
  paymentMethod?: string | null;
  receiptUrl?: string | null;
  paidAt?: Date;
};

export type FinalizeSuccessfulPaymentResult = {
  paymentId: number;
  orderId: number | null;
  customerId: number | null;
  alreadyPaid: boolean;
  finalized: boolean;
};

@Injectable()
export class PaymentFinalizeService {
  private readonly logger = new Logger(PaymentFinalizeService.name);

  constructor(
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
    private readonly dataSource: DataSource,
    private readonly activityService: ActivityService,
    private readonly customerActivityService: CustomerActivityService,
    @Inject(forwardRef(() => FunnelEventService))
    private readonly funnelEventService: FunnelEventService,
  ) {}

  async finalizeSuccessfulPayment(
    input: FinalizeSuccessfulPaymentInput,
  ): Promise<FinalizeSuccessfulPaymentResult> {
    const paidAt = input.paidAt ?? new Date();

    const result = await this.dataSource.transaction(async (manager) => {
      const payment = await manager.findOne(FunnelPayment, {
        where: { id: input.paymentId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!payment) {
        return null;
      }

      if (payment.status === FunnelPaymentStatus.REFUNDED) {
        return {
          paymentId: payment.id,
          orderId: payment.orderId,
          customerId: payment.customerId,
          alreadyPaid: false,
          finalized: false,
          skipSideEffects: true as const,
        };
      }

      const alreadyPaid = payment.status === FunnelPaymentStatus.PAID;

      if (!alreadyPaid) {
        payment.status = FunnelPaymentStatus.PAID;
        payment.paidAt = payment.paidAt ?? paidAt;
        payment.paymentSource = FunnelPaymentSource.STRIPE;
        payment.collectionChannel = FunnelCollectionChannel.ONLINE;
        payment.failedAt = null;
        payment.failureReason = null;
        payment.cancelledAt = null;
      }

      if (payment.customerId == null) {
        const resolvedCustomerId =
          await this.resolveCustomerIdFromPaymentEmail(manager, payment);
        if (resolvedCustomerId != null) {
          payment.customerId = resolvedCustomerId;
        }
      }

      this.applyStripeMetadata(payment, input);

      await manager.save(payment);
      const orderId = await this.ensureOrderForPaidPaymentInManager(
        manager,
        payment,
      );

      return {
        paymentId: payment.id,
        orderId,
        customerId: payment.customerId,
        alreadyPaid,
        finalized: !alreadyPaid,
        skipSideEffects: false as const,
      };
    });

    if (!result) {
      warnStripePayment({
        phase: 'finalize_successful_payment',
        outcome: 'payment_not_found',
        paymentId: input.paymentId,
        syncSource: input.source,
        webhookEventId: input.webhookEventId ?? null,
      });
      return {
        paymentId: input.paymentId,
        orderId: null,
        customerId: null,
        alreadyPaid: false,
        finalized: false,
      };
    }

    if (result.alreadyPaid) {
      logStripePayment({
        phase: 'finalize_successful_payment',
        outcome: 'already_paid_noop',
        paymentId: result.paymentId,
        orderId: result.orderId,
        customerId: result.customerId,
        paymentIntentId: input.stripePaymentIntentId ?? null,
        checkoutSessionId: input.stripeCheckoutSessionId ?? null,
        syncSource: input.source,
        webhookEventId: input.webhookEventId ?? null,
      });
      this.logger.log(
        `[FunnelPayment] paymentId=${result.paymentId} finalize no-op — already paid (source=${input.source})`,
      );
    } else if (result.finalized) {
      logStripePayment({
        phase: 'finalize_successful_payment',
        outcome: 'finalized',
        paymentId: result.paymentId,
        orderId: result.orderId,
        customerId: result.customerId,
        paymentIntentId: input.stripePaymentIntentId ?? null,
        checkoutSessionId: input.stripeCheckoutSessionId ?? null,
        syncSource: input.source,
        webhookEventId: input.webhookEventId ?? null,
      });
      this.logger.log(
        `[FunnelPayment] paymentId=${result.paymentId} finalized via ${input.source}` +
          (input.webhookEventId ? ` eventId=${input.webhookEventId}` : ''),
      );
    }

    if (result.skipSideEffects) {
      return {
        paymentId: result.paymentId,
        orderId: result.orderId,
        customerId: result.customerId,
        alreadyPaid: result.alreadyPaid,
        finalized: result.finalized,
      };
    }

    await this.runPostPaidSideEffects(result.paymentId, input.source);

    return {
      paymentId: result.paymentId,
      orderId: result.orderId,
      customerId: result.customerId,
      alreadyPaid: result.alreadyPaid,
      finalized: result.finalized,
    };
  }

  async ensureOrderForPaidPayment(paymentId: number): Promise<number | null> {
    return this.dataSource.transaction(async (manager) => {
      const payment = await manager.findOne(FunnelPayment, {
        where: { id: paymentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment || payment.status !== FunnelPaymentStatus.PAID) {
        return null;
      }
      return this.ensureOrderForPaidPaymentInManager(manager, payment);
    });
  }

  private applyStripeMetadata(
    payment: FunnelPayment,
    input: FinalizeSuccessfulPaymentInput,
  ): void {
    if (input.stripePaymentIntentId?.trim()) {
      payment.stripePaymentIntentId = input.stripePaymentIntentId.trim();
    }
    if (input.stripeCheckoutSessionId?.trim()) {
      payment.stripeCheckoutSessionId = input.stripeCheckoutSessionId.trim();
    }
    if (input.stripeConnectedAccountId?.trim()) {
      payment.stripeConnectedAccountId =
        input.stripeConnectedAccountId.trim();
    }
    if (input.stripeChargeId?.trim()) {
      payment.stripeChargeId = input.stripeChargeId.trim();
    }
    if (input.receiptUrl?.trim()) {
      payment.receiptUrl = input.receiptUrl.trim();
    }
    if (input.paymentMethod?.trim()) {
      payment.paymentMethod = input.paymentMethod.trim();
    }
  }

  private async resolveCustomerIdFromPaymentEmail(
    manager: EntityManager,
    payment: FunnelPayment,
  ): Promise<number | null> {
    const email = payment.customerEmail?.trim().toLowerCase();
    if (!email) {
      return null;
    }

    const customer = await manager
      .getRepository(Customer)
      .createQueryBuilder('c')
      .where('LOWER(c.email) = :email', { email })
      .getOne();

    return customer?.id ?? null;
  }

  private async ensureOrderForPaidPaymentInManager(
    manager: EntityManager,
    payment: FunnelPayment,
  ): Promise<number | null> {
    if (payment.status !== FunnelPaymentStatus.PAID) {
      return payment.orderId;
    }

    const source =
      payment.paymentSource === FunnelPaymentSource.SCANNER
        ? OrderSource.SCANNER
        : payment.paymentSource === FunnelPaymentSource.MANUAL
          ? OrderSource.MANUAL
          : OrderSource.STRIPE;

    const paidAt = payment.paidAt ?? new Date();

    if (payment.orderId != null) {
      await manager.update(Order, payment.orderId, {
        status: OrderStatus.PAID,
        source,
        totalAmount: payment.amount,
        currency: payment.currency || 'usd',
        paidAt,
      });
      return payment.orderId;
    }

    const order = await manager.save(
      manager.create(Order, {
        businessId: payment.businessId,
        status: OrderStatus.PAID,
        source,
        totalAmount: payment.amount,
        currency: payment.currency || 'usd',
        paidAt,
      }),
    );

    payment.orderId = order.id;
    await manager.update(FunnelPayment, payment.id, { orderId: order.id });
    return order.id;
  }

  private async runPostPaidSideEffects(
    paymentId: number,
    source: PaymentFinalizeSource,
  ): Promise<void> {
    try {
      await this.activityService.logPrepaidForOffer({
        paymentId,
        occurredAt: new Date(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('UQ_activity_event_idempotency') ||
        message.includes('duplicate key')
      ) {
        logStripePayment({
          phase: 'finalize_successful_payment',
          outcome: 'activity_already_exists',
          paymentId,
          syncSource: source,
        });
      } else {
        warnStripePayment({
          phase: 'finalize_successful_payment',
          outcome: 'activity_log_failed',
          paymentId,
          syncSource: source,
          error: message,
        });
      }
    }

    try {
      const payment = await this.funnelPaymentRepository.findOne({
        where: { id: paymentId },
      });
      if (
        payment &&
        payment.customerId != null &&
        payment.orderId != null &&
        payment.paymentSource !== FunnelPaymentSource.SCANNER
      ) {
        await this.customerActivityService.recordOnlinePurchase({
          businessId: payment.businessId,
          customerId: payment.customerId,
          orderId: payment.orderId,
          amountCents: payment.amount,
          currency: payment.currency || 'usd',
          funnelPaymentId: payment.id,
          funnelId: payment.funnelId,
          campaignId: payment.campaignId,
          occurredAt: payment.paidAt ?? new Date(),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('UQ_') ||
        message.includes('duplicate key') ||
        message.includes('idempotency')
      ) {
        logStripePayment({
          phase: 'finalize_successful_payment',
          outcome: 'customer_activity_already_exists',
          paymentId,
          syncSource: source,
        });
      } else {
        warnStripePayment({
          phase: 'finalize_successful_payment',
          outcome: 'customer_activity_log_failed',
          paymentId,
          syncSource: source,
          error: message,
        });
      }
    }

    try {
      await this.funnelEventService.syncPaidFunnelPaymentAutomation(paymentId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('UQ_activity_event_idempotency') ||
        message.includes('duplicate key')
      ) {
        logStripePayment({
          phase: 'finalize_successful_payment',
          outcome: 'automation_sync_idempotent_skip',
          paymentId,
          syncSource: source,
        });
        return;
      }
      warnStripePayment({
        phase: 'finalize_successful_payment',
        outcome: 'automation_sync_failed',
        paymentId,
        syncSource: source,
        error: message,
      });
    }
  }
}
