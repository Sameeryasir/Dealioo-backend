import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { Repository } from 'typeorm';
import {
  FunnelPayment,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { campaignPriceToStripeAmount } from '../../utils/campaign-price-to-stripe-amount';
import { StripeService } from '../stripe/stripe.service';
import { CreatePaymentIntentDto } from './paymentDto/create-payment-intent.dto';

type PaymentIntentPayload = {
  id: string;
  last_payment_error?: { message?: string } | null;
  payment_method?: string | { id?: string } | null;
  charges?: { data?: Array<{ receipt_url?: string | null }> } | null;
  latest_charge?: string | { receipt_url?: string | null } | null;
};

type ChargePayload = {
  id: string;
  payment_intent?: string | { id: string } | null;
  refunds?: { data?: Array<{ id?: string }> } | null;
  status?: string;
  receipt_url?: string | null;
};

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly stripe: InstanceType<typeof Stripe>;

  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
    private readonly stripeService: StripeService,
  ) {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }
    this.stripe = new Stripe(stripeSecretKey);
  }

  async handleStripeWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<{ received: boolean }> {
    this.logger.log(
      JSON.stringify({
        scope: 'stripe_webhook',
        phase: 'validate',
        rawBodyBytes: rawBody?.length ?? 0,
        hasSignature: Boolean(signature),
      }),
    );

    if (!rawBody?.length) {
      this.logger.warn(
        JSON.stringify({
          scope: 'stripe_webhook',
          phase: 'validate',
          error: 'missing_raw_body',
        }),
      );
      throw new BadRequestException('Missing raw body');
    }
    if (!signature) {
      this.logger.warn(
        JSON.stringify({
          scope: 'stripe_webhook',
          phase: 'validate',
          error: 'missing_stripe_signature_header',
        }),
      );
      throw new BadRequestException('Missing Stripe signature.');
    }

    const rawWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const webhookSecret = rawWebhookSecret?.trim() ?? '';
    if (!webhookSecret) {
      this.logger.error(
        JSON.stringify({
          scope: 'stripe_webhook',
          phase: 'validate',
          error: 'STRIPE_WEBHOOK_SECRET_not_configured',
        }),
      );
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
      this.logger.error(
        JSON.stringify({
          scope: 'stripe_webhook',
          phase: 'signature',
          error: 'constructEvent_failed',
        }),
        error,
      );
      throw new BadRequestException('Invalid Stripe webhook signature.');
    }

    this.logger.log(
      JSON.stringify({
        scope: 'stripe_webhook',
        phase: 'event_verified',
        eventType: event.type,
        eventId: event.id,
        livemode: event.livemode,
        apiVersion: event.api_version ?? null,
        stripeConnectAccount: event.account ?? null,
      }),
    );

    const connectedAccountId = event.account ?? undefined;

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

      default:
        this.logger.log(
          JSON.stringify({
            scope: 'stripe_webhook',
            phase: 'route',
            outcome: 'no_funnel_payment_handler',
            eventType: event.type,
            eventId: event.id,
          }),
        );
        break;
    }

    const response = { received: true as const };
    this.logger.log(
      JSON.stringify({
        scope: 'stripe_webhook',
        phase: 'response',
        body: response,
        eventType: event.type,
        eventId: event.id,
      }),
    );
    return response;
  }

  private async handlePaymentIntentSucceeded(
    paymentIntent: PaymentIntentPayload,
    connectedAccountId?: string,
  ) {
    this.logger.log(
      JSON.stringify({
        scope: 'stripe_webhook',
        handler: 'payment_intent.succeeded',
        paymentIntentId: paymentIntent.id,
        stripeConnectAccount: connectedAccountId ?? null,
      }),
    );

    const payment = await this.funnelPaymentRepository.findOne({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (!payment) {
      this.logger.warn(
        JSON.stringify({
          scope: 'stripe_webhook',
          handler: 'payment_intent.succeeded',
          outcome: 'funnel_payment_not_found',
          paymentIntentId: paymentIntent.id,
        }),
      );
      return;
    }

    if (payment.status === FunnelPaymentStatus.REFUNDED) {
      this.logger.warn(
        JSON.stringify({
          scope: 'stripe_webhook',
          handler: 'payment_intent.succeeded',
          outcome: 'skip_already_refunded',
          funnelPaymentId: payment.id,
          paymentIntentId: paymentIntent.id,
        }),
      );
      return;
    }

    const paymentMethodId = this.paymentMethodIdFromIntent(paymentIntent);
    const receiptUrl = this.receiptUrlFromIntent(paymentIntent);

    const updateResult = await this.funnelPaymentRepository.update(
      payment.id,
      {
        status: FunnelPaymentStatus.PAID,
        paidAt: new Date(),
        stripeConnectedAccountId:
          connectedAccountId ?? payment.stripeConnectedAccountId,
        ...(paymentMethodId ? { paymentMethod: paymentMethodId } : {}),
        ...(receiptUrl ? { receiptUrl } : {}),
      },
    );

    this.logger.log(
      JSON.stringify({
        scope: 'stripe_webhook',
        handler: 'payment_intent.succeeded',
        outcome: 'funnel_payment_updated',
        funnelPaymentId: payment.id,
        previousStatus: payment.status,
        newStatus: FunnelPaymentStatus.PAID,
        rowsAffected: updateResult.affected ?? 0,
        paymentIntentId: paymentIntent.id,
        setPaymentMethod: Boolean(paymentMethodId),
        setReceiptUrl: Boolean(receiptUrl),
      }),
    );
  }

  private paymentMethodIdFromIntent(
    pi: PaymentIntentPayload,
  ): string | undefined {
    const pm = pi.payment_method;
    if (!pm) {
      return undefined;
    }
    if (typeof pm === 'string') {
      return pm;
    }
    if (typeof pm === 'object' && pm.id) {
      return pm.id;
    }
    return undefined;
  }

  private receiptUrlFromIntent(pi: PaymentIntentPayload): string | undefined {
    const fromCharges = pi.charges?.data?.[0]?.receipt_url;
    if (fromCharges) {
      return fromCharges;
    }
    const lc = pi.latest_charge;
    if (lc && typeof lc === 'object' && lc.receipt_url) {
      return lc.receipt_url;
    }
    return undefined;
  }

  private async markFunnelPaymentPaidFromSucceededCharge(
    charge: ChargePayload,
    connectedAccountId?: string,
  ): Promise<void> {
    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;

    this.logger.log(
      JSON.stringify({
        scope: 'stripe_webhook',
        handler: 'charge_success_fallback',
        chargeId: charge.id,
        chargeStatus: charge.status ?? null,
        paymentIntentId: paymentIntentId ?? null,
        stripeConnectAccount: connectedAccountId ?? null,
      }),
    );

    if (charge.status !== 'succeeded') {
      this.logger.log(
        JSON.stringify({
          scope: 'stripe_webhook',
          handler: 'charge_success_fallback',
          outcome: 'skip_charge_not_succeeded',
          chargeId: charge.id,
          chargeStatus: charge.status ?? null,
        }),
      );
      return;
    }
    if (!paymentIntentId) {
      this.logger.log(
        JSON.stringify({
          scope: 'stripe_webhook',
          handler: 'charge_success_fallback',
          outcome: 'skip_no_payment_intent_on_charge',
          chargeId: charge.id,
        }),
      );
      return;
    }

    const payment = await this.funnelPaymentRepository.findOne({
      where: { stripePaymentIntentId: paymentIntentId },
    });

    if (!payment) {
      this.logger.warn(
        JSON.stringify({
          scope: 'stripe_webhook',
          handler: 'charge_success_fallback',
          outcome: 'funnel_payment_not_found',
          paymentIntentId,
          chargeId: charge.id,
        }),
      );
      return;
    }

    const receiptFromCharge = charge.receipt_url?.trim();
    if (
      receiptFromCharge &&
      !payment.receiptUrl &&
      (payment.status === FunnelPaymentStatus.PENDING ||
        payment.status === FunnelPaymentStatus.PAID)
    ) {
      const receiptUpdate = await this.funnelPaymentRepository.update(
        payment.id,
        {
          receiptUrl: receiptFromCharge,
          stripeConnectedAccountId:
            connectedAccountId ?? payment.stripeConnectedAccountId,
        },
      );
      this.logger.log(
        JSON.stringify({
          scope: 'stripe_webhook',
          handler: 'charge_receipt_url_sync',
          outcome: 'funnel_payment_receipt_updated',
          funnelPaymentId: payment.id,
          paymentIntentId,
          chargeId: charge.id,
          rowsAffected: receiptUpdate.affected ?? 0,
        }),
      );
    }

    if (payment.status !== FunnelPaymentStatus.PENDING) {
      this.logger.log(
        JSON.stringify({
          scope: 'stripe_webhook',
          handler: 'charge_success_fallback',
          outcome: 'skip_funnel_payment_not_pending',
          funnelPaymentId: payment.id,
          currentStatus: payment.status,
          paymentIntentId,
        }),
      );
      return;
    }

    await this.handlePaymentIntentSucceeded(
      { id: paymentIntentId },
      connectedAccountId,
    );
  }

  private async handlePaymentIntentFailed(
    paymentIntent: PaymentIntentPayload,
    connectedAccountId?: string,
  ) {
    this.logger.log(
      JSON.stringify({
        scope: 'stripe_webhook',
        handler: 'payment_intent.payment_failed',
        paymentIntentId: paymentIntent.id,
        stripeConnectAccount: connectedAccountId ?? null,
      }),
    );

    const payment = await this.funnelPaymentRepository.findOne({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (!payment) {
      this.logger.warn(
        JSON.stringify({
          scope: 'stripe_webhook',
          handler: 'payment_intent.payment_failed',
          outcome: 'funnel_payment_not_found',
          paymentIntentId: paymentIntent.id,
        }),
      );
      return;
    }

    const failureMessage =
      paymentIntent.last_payment_error?.message ?? 'Payment failed';

    const updateResult = await this.funnelPaymentRepository.update(
      payment.id,
      {
        status: FunnelPaymentStatus.FAILED,
        failedAt: new Date(),
        failureReason: failureMessage,
        stripeConnectedAccountId:
          connectedAccountId ?? payment.stripeConnectedAccountId,
      },
    );

    this.logger.log(
      JSON.stringify({
        scope: 'stripe_webhook',
        handler: 'payment_intent.payment_failed',
        outcome: 'funnel_payment_updated',
        funnelPaymentId: payment.id,
        rowsAffected: updateResult.affected ?? 0,
        paymentIntentId: paymentIntent.id,
        failureReason: failureMessage,
      }),
    );
  }

  private async handlePaymentIntentCanceled(
    paymentIntent: PaymentIntentPayload,
    connectedAccountId?: string,
  ) {
    this.logger.log(
      JSON.stringify({
        scope: 'stripe_webhook',
        handler: 'payment_intent.canceled',
        paymentIntentId: paymentIntent.id,
        stripeConnectAccount: connectedAccountId ?? null,
      }),
    );

    const payment = await this.funnelPaymentRepository.findOne({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (!payment) {
      this.logger.warn(
        JSON.stringify({
          scope: 'stripe_webhook',
          handler: 'payment_intent.canceled',
          outcome: 'funnel_payment_not_found',
          paymentIntentId: paymentIntent.id,
        }),
      );
      return;
    }

    const updateResult = await this.funnelPaymentRepository.update(
      payment.id,
      {
        status: FunnelPaymentStatus.CANCELLED,
        cancelledAt: new Date(),
        stripeConnectedAccountId:
          connectedAccountId ?? payment.stripeConnectedAccountId,
      },
    );

    this.logger.log(
      JSON.stringify({
        scope: 'stripe_webhook',
        handler: 'payment_intent.canceled',
        outcome: 'funnel_payment_updated',
        funnelPaymentId: payment.id,
        rowsAffected: updateResult.affected ?? 0,
        paymentIntentId: paymentIntent.id,
      }),
    );
  }

  private async handleChargeRefunded(
    charge: ChargePayload,
    connectedAccountId?: string,
  ) {
    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;

    this.logger.log(
      JSON.stringify({
        scope: 'stripe_webhook',
        handler: 'charge.refunded',
        chargeId: charge.id,
        paymentIntentId: paymentIntentId ?? null,
        stripeConnectAccount: connectedAccountId ?? null,
      }),
    );

    if (!paymentIntentId) {
      this.logger.warn(
        JSON.stringify({
          scope: 'stripe_webhook',
          handler: 'charge.refunded',
          outcome: 'skip_no_payment_intent_on_charge',
          chargeId: charge.id,
        }),
      );
      return;
    }

    const payment = await this.funnelPaymentRepository.findOne({
      where: { stripePaymentIntentId: paymentIntentId },
    });

    if (!payment) {
      this.logger.warn(
        JSON.stringify({
          scope: 'stripe_webhook',
          handler: 'charge.refunded',
          outcome: 'funnel_payment_not_found',
          paymentIntentId,
          chargeId: charge.id,
        }),
      );
      return;
    }

    const refundId = charge.refunds?.data?.[0]?.id ?? null;

    const updateResult = await this.funnelPaymentRepository.update(
      payment.id,
      {
        status: FunnelPaymentStatus.REFUNDED,
        refundedAt: new Date(),
        stripeRefundId: refundId,
        stripeConnectedAccountId:
          connectedAccountId ?? payment.stripeConnectedAccountId,
      },
    );

    this.logger.log(
      JSON.stringify({
        scope: 'stripe_webhook',
        handler: 'charge.refunded',
        outcome: 'funnel_payment_updated',
        funnelPaymentId: payment.id,
        rowsAffected: updateResult.affected ?? 0,
        paymentIntentId,
        stripeRefundId: refundId,
      }),
    );
  }

  async createPaymentIntent(dto: CreatePaymentIntentDto): Promise<{
    clientSecret: string;
    paymentIntentId: string;
    paymentId: number;
    stripeAccountId: string;
  }> {
    const restaurant = await this.restaurantRepository.findOne({
      where: { id: dto.restaurantId },
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    if (!restaurant.stripeAccountId) {
      throw new BadRequestException('Stripe account not connected');
    }

    const funnel = await this.funnelRepository.findOne({
      where: { id: dto.funnelId },
      relations: ['campaign'],
    });

    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    if (!funnel.campaign) {
      throw new NotFoundException('Campaign not found for this funnel');
    }

    if (funnel.campaign.restaurantId !== dto.restaurantId) {
      throw new BadRequestException(
        'This funnel does not belong to the given restaurant.',
      );
    }

    const amount = campaignPriceToStripeAmount(
      funnel.campaign.price,
      dto.currency,
    );
    if (!Number.isFinite(amount) || amount < 1) {
      throw new BadRequestException(
        'Campaign price is missing or invalid for checkout.',
      );
    }

    if (dto.applicationFeeAmount >= amount) {
      throw new BadRequestException(
        'Application fee must be less than the payment amount.',
      );
    }

    const paymentIntent =
      await this.stripeService.createPaymentIntentOnConnectedAccount({
        stripeAccountId: restaurant.stripeAccountId,
        amount,
        currency: dto.currency,
        applicationFeeAmount: dto.applicationFeeAmount,
        receiptEmail: dto.customerEmail,
        metadata: {
          funnelId: String(dto.funnelId),
          restaurantId: String(dto.restaurantId),
          campaignId: String(funnel.campaign.id),
        },
      });

    const payment = this.funnelPaymentRepository.create({
      funnelId: dto.funnelId,
      restaurantId: dto.restaurantId,
      stripePaymentIntentId: paymentIntent.id,
      stripeConnectedAccountId: restaurant.stripeAccountId,
      amount,
      currency: dto.currency.toLowerCase(),
      customerEmail: dto.customerEmail,
      status: FunnelPaymentStatus.PENDING,
    });

    await this.funnelPaymentRepository.save(payment);

    return {
      clientSecret: paymentIntent.client_secret!,
      paymentIntentId: paymentIntent.id,
      paymentId: payment.id,
      stripeAccountId: restaurant.stripeAccountId,
    };
  }
}
