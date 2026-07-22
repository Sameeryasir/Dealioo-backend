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
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { DataSource, MoreThan, Repository } from 'typeorm';
import {
  FunnelCollectionChannel,
  FunnelPayment,
  FunnelPaymentMethod,
  FunnelPaymentSource,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Business } from '../../db/entities/business.entity';
import { getFrontendBaseUrl } from '../../utils/frontend-base-url';
import { CouponService } from '../redemption/coupon.service';
import { StripeCatalogService } from '../stripe/stripe-catalog.service';
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

type CheckoutSessionResult = {
  clientSecret?: string;
  checkoutSessionId: string;
  paymentIntentId?: string;
  paymentId: number;
  stripeAccountId: string;
  reused: boolean;
  alreadyCompleted?: boolean;
};

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
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly stripeService: StripeService,
    private readonly stripeCatalogService: StripeCatalogService,
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


  private async syncPendingPaymentFromStripe(
    payment: FunnelPayment,
  ): Promise<boolean> {
    const accountId = payment.stripeConnectedAccountId?.trim();
    if (!accountId) {
      return false;
    }


    const sessionId = payment.stripeCheckoutSessionId?.trim();
    if (sessionId) {
      try {
        const session =
          await this.stripeService.retrieveCheckoutSessionOnConnectedAccount(
            accountId,
            sessionId,
          );
        const paymentIntentId = this.paymentIntentIdFromSession(session);

        if (
          session.status === 'complete' ||
          session.payment_status === 'paid'
        ) {
          await this.funnelPaymentRepository.update(payment.id, {
            status: FunnelPaymentStatus.PAID,
            paidAt: payment.paidAt ?? new Date(),
            ...(paymentIntentId
              ? { stripePaymentIntentId: paymentIntentId }
              : {}),
          });
          logStripePayment({
            phase: 'payment_status_sync',
            outcome: 'marked_paid_from_checkout_session',
            paymentId: payment.id,
            checkoutSessionId: sessionId,
            paymentIntentId: paymentIntentId ?? null,
          });
          return true;
        }

        if (session.status === 'expired') {
          await this.funnelPaymentRepository.update(payment.id, {
            status: FunnelPaymentStatus.CANCELLED,
            cancelledAt: payment.cancelledAt ?? new Date(),
          });
          return true;
        }
      } catch (err) {
        warnStripePayment({
          phase: 'payment_status_sync',
          outcome: 'checkout_session_retrieve_failed',
          paymentId: payment.id,
          checkoutSessionId: sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const piId = payment.stripePaymentIntentId?.trim();
    if (!piId) {
      return false;
    }
    try {
      const pi =
        await this.stripeService.retrievePaymentIntentOnConnectedAccount(
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
          failureReason: pi.last_payment_error.message ?? 'Payment failed',
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


  async createPaymentIntent(dto: CreatePaymentIntentDto) {
    return this.createPaymentSession(dto);
  }


  async createPaymentSession(
    dto: CreatePaymentIntentDto,
    isReplacementAttempt = false,
  ): Promise<CheckoutSessionResult> {
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

    const catalog =
      await this.stripeCatalogService.ensureCampaignCatalogOnConnectedAccount({
        campaign: funnel.campaign,
        stripeAccountId,
        currency: checkoutIdentity.currency,
      });

    const { applicationFeeAmount } = this.feeService.calculatePlatformFee({
      chargeAmountMinor: catalog.amount,
      currency: catalog.currency,
      businessId: checkoutIdentity.businessId,
      campaignId: funnel.campaign.id,
    });

    if (applicationFeeAmount >= catalog.amount) {
      throw new BadRequestException(
        'Platform fee configuration is invalid for this charge amount.',
      );
    }

    const customerEmail = checkoutIdentity.customerEmail.trim().toLowerCase();

    // --- Idempotent claim: one PENDING payment per business+funnel+guest ---
    const payment = await this.claimOrCreatePendingPayment({
      funnelId: checkoutIdentity.funnelId,
      businessId: checkoutIdentity.businessId,
      campaignId: funnel.campaign.id,
      stripeAccountId,
      amount: catalog.amount,
      currency: catalog.currency,
      platformFeeAmount: applicationFeeAmount,
      customerEmail,
    });

    const result = await this.ensureOpenCheckoutSessionForPayment({
      payment,
      stripeAccountId,
      stripePriceId: catalog.stripePriceId,
      applicationFeeAmount,
      currency: catalog.currency,
      productName: catalog.productName,
      campaignId: funnel.campaign.id,
      customerEmail,
      customerId: checkoutIdentity.customerId,
      checkoutSessionToken: checkoutIdentity.checkoutSessionToken,
      funnelId: checkoutIdentity.funnelId,
      businessId: checkoutIdentity.businessId,
    });

    // Expired/incompatible open session was cancelled — start a fresh attempt.
    if (result == null) {
      if (isReplacementAttempt) {
        throw new InternalServerErrorException(
          'Could not create a checkout session for this purchase. Please try again.',
        );
      }
      return this.createPaymentSession(dto, true);
    }

    return result;
  }

  private checkoutGuestLockKeys(
    businessId: number,
    funnelId: number,
    customerEmail: string,
  ): [number, number] {
    const email = customerEmail.trim().toLowerCase();
    let hash = 2166136261;
    for (let i = 0; i < email.length; i += 1) {
      hash ^= email.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const key1 = (Math.imul(businessId, 1_000_003) + funnelId) | 0;
    const key2 = hash | 0;
    return [key1, key2];
  }

  private pendingReuseCutoff(): Date {
    return new Date(
      Date.now() -
        PaymentWebhookHandler.PENDING_REUSE_HOURS * 60 * 60 * 1000,
    );
  }

  private async claimOrCreatePendingPayment(opts: {
    funnelId: number;
    businessId: number;
    campaignId: number;
    stripeAccountId: string;
    amount: number;
    currency: string;
    platformFeeAmount: number;
    customerEmail: string;
  }): Promise<FunnelPayment> {
    const [lockKey1, lockKey2] = this.checkoutGuestLockKeys(
      opts.businessId,
      opts.funnelId,
      opts.customerEmail,
    );
    const cutoff = this.pendingReuseCutoff();

    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [
        lockKey1,
        lockKey2,
      ]);

      const pending = await manager.findOne(FunnelPayment, {
        where: {
          funnelId: opts.funnelId,
          businessId: opts.businessId,
          customerEmail: opts.customerEmail,
          status: FunnelPaymentStatus.PENDING,
          createdAt: MoreThan(cutoff),
        },
        order: { createdAt: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });

      if (pending) {
        logStripePayment({
          phase: 'checkout_session_claim',
          outcome: 'reuse_pending_payment',
          paymentId: pending.id,
          checkoutSessionId: pending.stripeCheckoutSessionId,
        });
        return pending;
      }

      const created = manager.create(FunnelPayment, {
        funnelId: opts.funnelId,
        businessId: opts.businessId,
        campaignId: opts.campaignId,
        stripeConnectedAccountId: opts.stripeAccountId,
        amount: opts.amount,
        currency: opts.currency,
        platformFeeAmount: opts.platformFeeAmount,
        customerEmail: opts.customerEmail,
        status: FunnelPaymentStatus.PENDING,
        paymentSource: FunnelPaymentSource.STRIPE,
        collectionChannel: FunnelCollectionChannel.ONLINE,
        paymentMethod: FunnelPaymentMethod.ONLINE_CARD,
        stripePaymentIntentId: null,
        stripeCheckoutSessionId: null,
        refundedAmount: 0,
      });

      const saved = await manager.save(created);
      logStripePayment({
        phase: 'checkout_session_claim',
        outcome: 'created_pending_payment',
        paymentId: saved.id,
      });
      return saved;
    });
  }

  private async ensureOpenCheckoutSessionForPayment(opts: {
    payment: FunnelPayment;
    stripeAccountId: string;
    stripePriceId: string;
    applicationFeeAmount: number;
    currency: string;
    productName: string;
    campaignId: number;
    customerEmail: string;
    customerId?: number;
    checkoutSessionToken?: string;
    funnelId: number;
    businessId: number;
  }): Promise<CheckoutSessionResult | null> {
    const payment = opts.payment;
    const existingSessionId = payment.stripeCheckoutSessionId?.trim();

    if (existingSessionId) {
      const reused = await this.tryReuseExistingCheckoutSession({
        payment,
        sessionId: existingSessionId,
        stripeAccountId: opts.stripeAccountId,
        customerId: opts.customerId,
        funnelId: opts.funnelId,
      });

      if (reused === 'create_new_attempt') {
        return null;
      }
      if (reused) {
        await this.attachCheckoutSessionPayment(
          opts.checkoutSessionToken,
          reused.paymentId,
        );
        return reused;
      }
    }

    const metadata = {
      ...this.buildPaymentMetadata(payment, opts.campaignId),
      sessionUiVersion: 'card-no-save-v1',
    };
    const returnUrl = this.buildFunnelCheckoutReturnUrl({
      funnelId: opts.funnelId,
      businessId: opts.businessId,
      campaignId: opts.campaignId,
      checkoutSessionToken: opts.checkoutSessionToken,
    });

    const session =
      await this.stripeService.createCheckoutSessionOnConnectedAccount({
        stripeAccountId: opts.stripeAccountId,
        stripePriceId: opts.stripePriceId,
        returnUrl,
        customerEmail: opts.customerEmail,
        applicationFeeAmount: opts.applicationFeeAmount,
        currency: opts.currency,
        description: opts.productName,
        metadata,
        // Same payment id always maps to the same Stripe session under concurrency.
        idempotencyKey: `checkout-session-${payment.id}-pm-v5`,
        paymentId: payment.id,
        funnelId: payment.funnelId,
        businessId: payment.businessId,
        campaignId: opts.campaignId,
      });

    const paymentIntentId = this.paymentIntentIdFromSession(session);

    await this.funnelPaymentRepository.update(payment.id, {
      stripeCheckoutSessionId: session.id,
      ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
    });

    await this.linkSignupPassToPayment(
      opts.customerId,
      opts.funnelId,
      payment.id,
    );

    await this.attachCheckoutSessionPayment(
      opts.checkoutSessionToken,
      payment.id,
    );

    return {
      clientSecret: session.client_secret!,
      checkoutSessionId: session.id,
      paymentIntentId,
      paymentId: payment.id,
      stripeAccountId: opts.stripeAccountId,
      reused: Boolean(existingSessionId),
    };
  }

  private async tryReuseExistingCheckoutSession(opts: {
    payment: FunnelPayment;
    sessionId: string;
    stripeAccountId: string;
    customerId?: number;
    funnelId: number;
  }): Promise<CheckoutSessionResult | 'create_new_attempt' | null> {
    const { payment, sessionId } = opts;

    try {
      const session =
        await this.stripeService.retrieveCheckoutSessionOnConnectedAccount(
          opts.stripeAccountId,
          sessionId,
        );
      const paymentIntentId = this.paymentIntentIdFromSession(session);

      if (session.status === 'complete' || session.payment_status === 'paid') {
        await this.funnelPaymentRepository.update(payment.id, {
          status: FunnelPaymentStatus.PAID,
          paidAt: payment.paidAt ?? new Date(),
          stripeConnectedAccountId: opts.stripeAccountId,
          ...(paymentIntentId
            ? { stripePaymentIntentId: paymentIntentId }
            : {}),
        });
        await this.linkSignupPassToPayment(
          opts.customerId,
          opts.funnelId,
          payment.id,
        );
        return {
          checkoutSessionId: session.id,
          paymentIntentId,
          paymentId: payment.id,
          stripeAccountId: opts.stripeAccountId,
          reused: true,
          alreadyCompleted: true,
        };
      }

      if (session.status === 'expired') {
        await this.funnelPaymentRepository.update(payment.id, {
          status: FunnelPaymentStatus.CANCELLED,
          cancelledAt: payment.cancelledAt ?? new Date(),
        });
        return 'create_new_attempt';
      }

      if (session.status === 'open' && session.client_secret) {
        const methods = session.payment_method_types ?? [];
        const isCardOnly = methods.length === 1 && methods[0] === 'card';
        const promoDisabled = session.allow_promotion_codes !== true;
        const uiVersion = session.metadata?.sessionUiVersion;
        const isNoSaveUi = uiVersion === 'card-no-save-v1';

        if (!isCardOnly || !promoDisabled || !isNoSaveUi) {
          try {
            await this.stripeService.expireCheckoutSessionOnConnectedAccount(
              opts.stripeAccountId,
              session.id,
            );
          } catch {
            // Best-effort expire before starting a replacement attempt.
          }
          await this.funnelPaymentRepository.update(payment.id, {
            status: FunnelPaymentStatus.CANCELLED,
            cancelledAt: payment.cancelledAt ?? new Date(),
          });
          return 'create_new_attempt';
        }

        if (
          paymentIntentId &&
          paymentIntentId !== payment.stripePaymentIntentId
        ) {
          await this.funnelPaymentRepository.update(payment.id, {
            stripePaymentIntentId: paymentIntentId,
          });
        }

        await this.linkSignupPassToPayment(
          opts.customerId,
          opts.funnelId,
          payment.id,
        );

        logStripePayment({
          phase: 'checkout_session_reuse',
          outcome: 'open_session',
          paymentId: payment.id,
          checkoutSessionId: session.id,
          paymentIntentId: paymentIntentId ?? null,
        });

        return {
          clientSecret: session.client_secret,
          checkoutSessionId: session.id,
          paymentIntentId,
          paymentId: payment.id,
          stripeAccountId: opts.stripeAccountId,
          reused: true,
        };
      }

      return null;
    } catch {
      warnStripePayment({
        phase: 'checkout_session_reuse',
        outcome: 'retrieve_failed',
        paymentId: payment.id,
        checkoutSessionId: sessionId,
      });
      return null;
    }
  }

  private buildFunnelCheckoutReturnUrl(opts: {
    funnelId: number;
    businessId: number;
    campaignId: number;
    checkoutSessionToken?: string;
  }): string {
    const params = new URLSearchParams();
    params.set('campaignId', String(opts.campaignId));
    params.set('businessId', String(opts.businessId));
    if (opts.checkoutSessionToken?.trim()) {
      params.set('checkoutToken', opts.checkoutSessionToken.trim());
    }
    params.set('redirect_status', 'succeeded');
    params.set('payment_confirmed', '1');
    return `${getFrontendBaseUrl().replace(/\/$/, '')}/funnel/${opts.funnelId}/confirmation?${params.toString()}`;
  }

  private paymentIntentIdFromSession(session: {
    payment_intent?: string | { id?: string } | null;
  }): string | undefined {
    const pi = session.payment_intent;
    if (typeof pi === 'string' && pi.trim()) return pi.trim();
    if (pi && typeof pi === 'object' && typeof pi.id === 'string') {
      return pi.id.trim() || undefined;
    }
    return undefined;
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
