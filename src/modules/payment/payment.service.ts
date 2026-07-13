import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { MoreThan, Repository } from 'typeorm';
import {
  FunnelPayment,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Business } from '../../db/entities/business.entity';
import { campaignPriceToStripeAmount } from '../../utils/campaign-price-to-stripe-amount';
import { CouponService } from '../redemption/coupon.service';
import { StripeService } from '../stripe/stripe.service';
import { CreatePaymentIntentDto } from './paymentDto/create-payment-intent.dto';
import { FeeService } from './fee.service';
import {
  errorStripePayment,
  logStripePayment,
  warnStripePayment,
} from './payment-logger';
import { PaymentWebhookHandler } from './payment-webhook.handler';
import { StripeWebhookService } from './stripe-webhook.service';
import { CheckoutResumeService } from './checkout-resume.service';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
} from '../../common/pagination';
import { UserSubscriptionsService } from '../user-subscriptions/user-subscriptions.service';
import { FunnelEventService } from '../funnel-event/funnel-event.service';

@Injectable()
export class PaymentService implements OnModuleInit {
  private readonly logger = new Logger(PaymentService.name);
  private readonly stripe: InstanceType<typeof Stripe>;

  constructor(
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
    private readonly stripeService: StripeService,
    private readonly feeService: FeeService,
    private readonly stripeWebhookService: StripeWebhookService,
    private readonly paymentWebhookHandler: PaymentWebhookHandler,
    private readonly couponService: CouponService,
    private readonly checkoutResumeService: CheckoutResumeService,
    private readonly userSubscriptionsService: UserSubscriptionsService,
    @Inject(forwardRef(() => FunnelEventService))
    private readonly funnelEventService: FunnelEventService,
  ) {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }
    this.stripe = this.stripeService.getPlatformClient();
  }

  onModuleInit(): void {
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secret) {
      this.logger.warn(
        'STRIPE_WEBHOOK_SECRET is not set — POST /payment/webhook will reject events. ' +
          'Run: stripe listen --forward-to localhost:4001/payment/webhook and copy the whsec_ value into .env',
      );
    }
  }

  async handleStripeWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<{ received: boolean }> {
    logStripePayment({
      phase: 'webhook_validate',
      outcome: 'start',
    });

    if (!rawBody?.length) {
      throw new BadRequestException('Missing raw body');
    }
    if (!signature) {
      throw new BadRequestException('Missing Stripe signature.');
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? '';
    if (!webhookSecret) {
      throw new InternalServerErrorException(
        'STRIPE_WEBHOOK_SECRET is not configured',
      );
    }

    let event: ReturnType<
      InstanceType<typeof Stripe>['webhooks']['constructEvent']
    >;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );
    } catch (error) {
      errorStripePayment({
        phase: 'webhook_signature',
        outcome: 'invalid',
        error: error instanceof Error ? error.message : String(error),
      });
      throw new BadRequestException('Invalid Stripe webhook signature.');
    }

    logStripePayment({
      phase: 'webhook_verified',
      eventId: event.id,
      eventType: event.type,
      stripeAccountId: event.account ?? null,
    });

    await this.stripeWebhookService.processOnce(event, async (ev, acct) => {
      await this.paymentWebhookHandler.routeEvent(ev, acct);
      await this.userSubscriptionsService.handleStripeWebhookEvent(ev);
    });

    return { received: true };
  }

  async getPaymentStatus(paymentId: number): Promise<{
    paymentId: number;
    status: FunnelPaymentStatus;
    stripePaymentIntentId: string | null;
    paidAt: Date | null;
    failureReason: string | null;
    refundedAmount: number;
    disputeStatus: string | null;
    syncedFromStripe?: boolean;
  }> {
    let payment = await this.funnelPaymentRepository.findOne({
      where: { id: paymentId },
    });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    let syncedFromStripe = false;
    if (payment.status === FunnelPaymentStatus.PENDING) {
      syncedFromStripe = await this.syncPendingPaymentFromStripe(payment);
      if (syncedFromStripe) {
        payment =
          (await this.funnelPaymentRepository.findOne({
            where: { id: paymentId },
          })) ?? payment;

        // --- Local/dev: start prepaid automation without blocking status poll ---
        if (payment.status === FunnelPaymentStatus.PAID) {
          const paidPaymentId = payment.id;
          this.logger.log(
            `[Prepaid Offer] Payment ${paidPaymentId} confirmed via status poll — queueing automation sync`,
          );
          void this.funnelEventService
            .syncPaidFunnelPaymentAutomation(paidPaymentId)
            .catch((err) => {
              this.logger.warn(
                `Prepaid automation sync failed for payment ${paidPaymentId}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            });
        }
      }
    }

    return {
      paymentId: payment.id,
      status: payment.status,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      paidAt: payment.paidAt,
      failureReason: payment.failureReason,
      refundedAmount: payment.refundedAmount,
      disputeStatus: payment.disputeStatus,
      ...(syncedFromStripe ? { syncedFromStripe: true } : {}),
    };
  }

  /** Fallback when webhooks did not run (local dev, missing secret, Connect events). */
  private async syncPendingPaymentFromStripe(
    payment: FunnelPayment,
  ): Promise<boolean> {
    const piId = payment.stripePaymentIntentId?.trim();
    const accountId = payment.stripeConnectedAccountId?.trim();
    if (!piId || !accountId) {
      return false;
    }
    try {
      const pi = await this.stripeService.retrievePaymentIntentOnConnectedAccount(
        accountId,
        piId,
      );
      if (pi.status === 'succeeded') {
        await this.funnelPaymentRepository.update(payment.id, {
          status: FunnelPaymentStatus.PAID,
          paidAt: payment.paidAt ?? new Date(),
        });
        logStripePayment({
          phase: 'payment_status_sync',
          outcome: 'marked_paid_from_stripe',
          paymentId: payment.id,
          paymentIntentId: piId,
        });
        return true;
      }
      if (pi.status === 'canceled') {
        await this.funnelPaymentRepository.update(payment.id, {
          status: FunnelPaymentStatus.CANCELLED,
          cancelledAt: payment.cancelledAt ?? new Date(),
        });
        return true;
      }
      if (pi.status === 'requires_payment_method' && pi.last_payment_error) {
        await this.funnelPaymentRepository.update(payment.id, {
          status: FunnelPaymentStatus.FAILED,
          failedAt: payment.failedAt ?? new Date(),
          failureReason:
            pi.last_payment_error.message ?? 'Payment failed',
        });
        return true;
      }
    } catch (err) {
      warnStripePayment({
        phase: 'payment_status_sync',
        outcome: 'stripe_retrieve_failed',
        paymentId: payment.id,
        paymentIntentId: piId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return false;
  }

  async createPaymentIntent(dto: CreatePaymentIntentDto): Promise<{
    clientSecret?: string;
    paymentIntentId: string;
    paymentId: number;
    stripeAccountId: string;
    reused: boolean;
    alreadyCompleted?: boolean;
  }> {
    const checkoutIdentity = await this.resolveCheckoutIdentity(dto);

    const business = await this.businessRepository.findOne({
      where: { id: checkoutIdentity.businessId },
    });

    if (!business) {
      throw new NotFoundException('Business not found');
    }

    if (!business.stripeAccountId) {
      throw new BadRequestException(
        'Stripe account not connected. Complete onboarding in Business Settings.',
      );
    }

    const funnel = await this.funnelRepository.findOne({
      where: { id: checkoutIdentity.funnelId },
      relations: ['campaign'],
    });

    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    if (!funnel.campaign) {
      throw new NotFoundException('Campaign not found for this funnel');
    }

    if (funnel.campaign.businessId !== checkoutIdentity.businessId) {
      throw new BadRequestException(
        'This funnel does not belong to the given business.',
      );
    }

    const stripeAccountId = business.stripeAccountId.trim();
    await this.stripeService.validateConnectedAccount(stripeAccountId);

    const currency = checkoutIdentity.currency;
    const amount = campaignPriceToStripeAmount(
      funnel.campaign.price,
      currency,
    );
    if (!Number.isFinite(amount) || amount < 1) {
      throw new BadRequestException(
        'Campaign price is missing or invalid for checkout.',
      );
    }

    const { applicationFeeAmount } = this.feeService.calculatePlatformFee({
      chargeAmountMinor: amount,
      currency,
      businessId: dto.businessId,
      campaignId: funnel.campaign.id,
    });

    if (applicationFeeAmount >= amount) {
      throw new BadRequestException(
        'Platform fee configuration is invalid for this charge amount.',
      );
    }

    const reused = await this.tryReusePendingPayment({
      funnelId: checkoutIdentity.funnelId,
      businessId: checkoutIdentity.businessId,
      customerEmail: checkoutIdentity.customerEmail,
      stripeAccountId,
      customerId: checkoutIdentity.customerId,
    });
    if (reused) {
      await this.attachCheckoutSessionPayment(
        checkoutIdentity.checkoutSessionToken,
        reused.paymentId,
      );
      return reused;
    }

    const payment = this.funnelPaymentRepository.create({
      funnelId: checkoutIdentity.funnelId,
      businessId: checkoutIdentity.businessId,
      campaignId: funnel.campaign.id,
      stripeConnectedAccountId: stripeAccountId,
      amount,
      currency,
      platformFeeAmount: applicationFeeAmount,
      customerEmail: checkoutIdentity.customerEmail.trim(),
      status: FunnelPaymentStatus.PENDING,
      stripePaymentIntentId: null,
      refundedAmount: 0,
    });

    await this.funnelPaymentRepository.save(payment);

    const metadata = this.buildPaymentMetadata(payment, funnel.campaign.id);

    const paymentIntent =
      await this.stripeService.createPaymentIntentOnConnectedAccount({
        stripeAccountId,
        amount,
        currency,
        applicationFeeAmount,
        receiptEmail: checkoutIdentity.customerEmail.trim(),
        idempotencyKey: `payment-intent-${payment.id}`,
        metadata,
      });

    await this.funnelPaymentRepository.update(payment.id, {
      stripePaymentIntentId: paymentIntent.id,
    });

    await this.linkSignupPassToPayment(
      checkoutIdentity.customerId,
      checkoutIdentity.funnelId,
      payment.id,
    );

    await this.attachCheckoutSessionPayment(
      checkoutIdentity.checkoutSessionToken,
      payment.id,
    );

    return {
      clientSecret: paymentIntent.client_secret!,
      paymentIntentId: paymentIntent.id,
      paymentId: payment.id,
      stripeAccountId,
      reused: false,
    };
  }

  private async linkSignupPassToPayment(
    customerId: number | undefined,
    funnelId: number,
    paymentId: number,
  ): Promise<void> {
    if (!customerId) {
      return;
    }
    await this.couponService.linkSignupCouponToPayment(
      customerId,
      funnelId,
      paymentId,
    );
  }

  private buildPaymentMetadata(
    payment: FunnelPayment,
    campaignId: number,
  ): Record<string, string> {
    return {
      paymentId: String(payment.id),
      funnelId: String(payment.funnelId),
      businessId: String(payment.businessId),
      campaignId: String(campaignId),
    };
  }

  private async tryReusePendingPayment(opts: {
    funnelId: number;
    businessId: number;
    customerEmail: string;
    stripeAccountId: string;
    customerId?: number;
  }): Promise<{
    clientSecret?: string;
    paymentIntentId: string;
    paymentId: number;
    stripeAccountId: string;
    reused: boolean;
    alreadyCompleted?: boolean;
  } | null> {
    const cutoff = new Date(
      Date.now() -
        PaymentWebhookHandler.PENDING_REUSE_HOURS * 60 * 60 * 1000,
    );

    const pending = await this.funnelPaymentRepository.findOne({
      where: {
        funnelId: opts.funnelId,
        businessId: opts.businessId,
        customerEmail: opts.customerEmail.trim(),
        status: FunnelPaymentStatus.PENDING,
        createdAt: MoreThan(cutoff),
      },
      order: { createdAt: 'DESC' },
    });

    if (!pending?.stripePaymentIntentId) {
      return null;
    }

    try {
      const pi = await this.stripeService.retrievePaymentIntentOnConnectedAccount(
        opts.stripeAccountId,
        pending.stripePaymentIntentId,
      );

      if (pi.status === 'succeeded') {
        await this.funnelPaymentRepository.update(pending.id, {
          status: FunnelPaymentStatus.PAID,
          paidAt: pending.paidAt ?? new Date(),
          stripeConnectedAccountId: opts.stripeAccountId,
        });
        logStripePayment({
          phase: 'payment_intent_reuse',
          outcome: 'already_succeeded_synced',
          paymentId: pending.id,
          paymentIntentId: pi.id,
          funnelId: pending.funnelId,
          businessId: pending.businessId,
        });
        await this.linkSignupPassToPayment(
          opts.customerId,
          opts.funnelId,
          pending.id,
        );

        return {
          paymentIntentId: pi.id,
          paymentId: pending.id,
          stripeAccountId: opts.stripeAccountId,
          reused: true,
          alreadyCompleted: true,
        };
      }

      if (pi.status === 'canceled') {
        await this.funnelPaymentRepository.update(pending.id, {
          status: FunnelPaymentStatus.CANCELLED,
          cancelledAt: pending.cancelledAt ?? new Date(),
        });
        return null;
      }

      if (
        !PaymentWebhookHandler.isReusablePaymentIntentStatus(pi.status) ||
        !pi.client_secret
      ) {
        return null;
      }

      logStripePayment({
        phase: 'payment_intent_reuse',
        outcome: 'success',
        paymentId: pending.id,
        paymentIntentId: pi.id,
        funnelId: pending.funnelId,
        businessId: pending.businessId,
      });

      await this.linkSignupPassToPayment(
        opts.customerId,
        opts.funnelId,
        pending.id,
      );

      return {
        clientSecret: pi.client_secret,
        paymentIntentId: pi.id,
        paymentId: pending.id,
        stripeAccountId: opts.stripeAccountId,
        reused: true,
      };
    } catch {
      warnStripePayment({
        phase: 'payment_intent_reuse',
        outcome: 'retrieve_failed',
        paymentId: pending.id,
        paymentIntentId: pending.stripePaymentIntentId,
      });
      return null;
    }
  }

  async getFunnelOrders(
    funnelId: number,
    page?: number,
    limit?: number,
  ): Promise<{
    funnelId: number;
    data: Array<ReturnType<PaymentService['toPublicFunnelPayment']>>;
    meta: PaginationMeta;
  }> {
    const funnel = await this.funnelRepository.findOne({
      where: { id: funnelId },
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    const pagination = normalizePagination(page, limit);

    // --- Sort by payment date (newest paid first) ---
    const [rows, total] = await this.funnelPaymentRepository
      .createQueryBuilder('payment')
      .where('payment.funnel_id = :funnelId', { funnelId })
      .andWhere('payment.status = :status', {
        status: FunnelPaymentStatus.PAID,
      })
      .orderBy('payment.paid_at', 'DESC', 'NULLS LAST')
      .addOrderBy('payment.created_at', 'DESC')
      .skip(pagination.skip)
      .take(pagination.limit)
      .getManyAndCount();

    return {
      funnelId,
      data: rows.map((row) => this.toPublicFunnelPayment(row)),
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  /** @deprecated Use getFunnelOrders — kept for older clients. */
  async getPaidFunnelPayments(funnelId: number): Promise<{
    funnelId: number;
    paymentCount: number;
    payments: Array<ReturnType<PaymentService['toPublicFunnelPayment']>>;
  }> {
    const funnel = await this.funnelRepository.findOne({
      where: { id: funnelId },
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    const rows = await this.funnelPaymentRepository
      .createQueryBuilder('payment')
      .where('payment.funnel_id = :funnelId', { funnelId })
      .andWhere('payment.status = :status', {
        status: FunnelPaymentStatus.PAID,
      })
      .orderBy('payment.paid_at', 'DESC', 'NULLS LAST')
      .addOrderBy('payment.created_at', 'DESC')
      .getMany();

    return {
      funnelId,
      paymentCount: rows.length,
      payments: rows.map((row) => this.toPublicFunnelPayment(row)),
    };
  }

  private toPublicFunnelPayment(payment: FunnelPayment) {
    return {
      id: payment.id,
      funnelId: payment.funnelId,
      businessId: payment.businessId,
      campaignId: payment.campaignId,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      customerEmail: payment.customerEmail,
      paymentMethod: payment.paymentMethod,
      receiptUrl: payment.receiptUrl,
      failureReason: payment.failureReason,
      failedAt: payment.failedAt,
      cancelledAt: payment.cancelledAt,
      stripeRefundId: payment.stripeRefundId,
      refundedAt: payment.refundedAt,
      refundedAmount: payment.refundedAmount,
      stripeDisputeId: payment.stripeDisputeId,
      disputeStatus: payment.disputeStatus,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }

  private async resolveCheckoutIdentity(dto: CreatePaymentIntentDto): Promise<{
    funnelId: number;
    businessId: number;
    currency: string;
    customerEmail: string;
    customerId?: number;
    checkoutSessionToken?: string;
  }> {
    const token = dto.checkoutSessionToken?.trim();
    if (token) {
      const session = await this.checkoutResumeService.resolveSession(token);
      if (session.funnelId !== dto.funnelId) {
        throw new BadRequestException(
          'Checkout token does not match this funnel.',
        );
      }
      if (session.businessId !== dto.businessId) {
        throw new BadRequestException(
          'Checkout token does not match this business.',
        );
      }
      return {
        funnelId: session.funnelId,
        businessId: session.businessId,
        currency: dto.currency.toLowerCase().trim(),
        customerEmail: session.customerEmail,
        customerId: session.customerId,
        checkoutSessionToken: token,
      };
    }

    return {
      funnelId: dto.funnelId,
      businessId: dto.businessId,
      currency: dto.currency.toLowerCase().trim(),
      customerEmail: dto.customerEmail.trim(),
      customerId: dto.customerId,
      checkoutSessionToken: undefined,
    };
  }

  private async attachCheckoutSessionPayment(
    checkoutSessionToken: string | undefined,
    paymentId: number,
  ): Promise<void> {
    const token = checkoutSessionToken?.trim();
    if (!token) {
      return;
    }

    try {
      await this.checkoutResumeService.attachPaymentToSession(token, paymentId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Checkout session update failed';
      warnStripePayment({
        phase: 'checkout_session_attach',
        outcome: 'failed',
        paymentId,
        error: message,
      });
    }
  }
}
