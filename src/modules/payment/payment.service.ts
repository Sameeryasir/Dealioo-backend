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
};

type ChargePayload = {
  id: string;
  payment_intent?: string | { id: string } | null;
  refunds?: { data?: Array<{ id?: string }> } | null;
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
    if (!rawBody?.length) {
      throw new BadRequestException('Missing raw body');
    }
    if (!signature) {
      throw new BadRequestException('Missing Stripe signature.');
    }

    const rawWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const webhookSecret = rawWebhookSecret?.trim() ?? '';
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
      this.logger.error('Invalid Stripe webhook signature', error);
      throw new BadRequestException('Invalid Stripe webhook signature.');
    }

    this.logger.log(
      `Stripe webhook event: type=${event.type} id=${event.id} account=${event.account ?? 'none'}`,
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

      default:
        this.logger.log(`Unhandled Stripe event: ${event.type}`);
        break;
    }

    const response = { received: true as const };
    this.logger.log(
      `Stripe webhook response: ${JSON.stringify(response)} (eventType=${event.type})`,
    );
    return response;
  }

  private async handlePaymentIntentSucceeded(
    paymentIntent: PaymentIntentPayload,
    connectedAccountId?: string,
  ) {
    const payment = await this.funnelPaymentRepository.findOne({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (!payment) {
      this.logger.warn(
        `Payment record not found for PaymentIntent: ${paymentIntent.id}`,
      );
      return;
    }

    await this.funnelPaymentRepository.update(payment.id, {
      status: FunnelPaymentStatus.PAID,
      paidAt: new Date(),
      stripeConnectedAccountId:
        connectedAccountId ?? payment.stripeConnectedAccountId,
    });
  }

  private async handlePaymentIntentFailed(
    paymentIntent: PaymentIntentPayload,
    connectedAccountId?: string,
  ) {
    const payment = await this.funnelPaymentRepository.findOne({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (!payment) {
      this.logger.warn(
        `Payment record not found for failed PaymentIntent: ${paymentIntent.id}`,
      );
      return;
    }

    await this.funnelPaymentRepository.update(payment.id, {
      status: FunnelPaymentStatus.FAILED,
      failedAt: new Date(),
      failureReason:
        paymentIntent.last_payment_error?.message ?? 'Payment failed',
      stripeConnectedAccountId:
        connectedAccountId ?? payment.stripeConnectedAccountId,
    });
  }

  private async handlePaymentIntentCanceled(
    paymentIntent: PaymentIntentPayload,
    connectedAccountId?: string,
  ) {
    const payment = await this.funnelPaymentRepository.findOne({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (!payment) {
      this.logger.warn(
        `Payment record not found for canceled PaymentIntent: ${paymentIntent.id}`,
      );
      return;
    }

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

    if (!paymentIntentId) {
      this.logger.warn(`Refunded charge has no PaymentIntent ID: ${charge.id}`);
      return;
    }

    const payment = await this.funnelPaymentRepository.findOne({
      where: { stripePaymentIntentId: paymentIntentId },
    });

    if (!payment) {
      this.logger.warn(
        `Payment record not found for refunded PaymentIntent: ${paymentIntentId}`,
      );
      return;
    }

    const refundId = charge.refunds?.data?.[0]?.id ?? null;

    await this.funnelPaymentRepository.update(payment.id, {
      status: FunnelPaymentStatus.REFUNDED,
      refundedAt: new Date(),
      stripeRefundId: refundId,
      stripeConnectedAccountId:
        connectedAccountId ?? payment.stripeConnectedAccountId,
    });
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
