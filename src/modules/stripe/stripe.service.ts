import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { Repository } from 'typeorm';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { User } from '../../db/entities/user.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import {
  errorStripePayment,
  logStripePayment,
} from '../payment/payment-logger';

const STRIPE_TIMEOUT_MS = 30_000;
const STRIPE_MAX_NETWORK_RETRIES = 2;

export type ValidatedConnectAccount = {
  id: string;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
};

@Injectable()
export class StripeService {
  private readonly stripe: InstanceType<typeof Stripe>;
  private readonly platformSecretKey: string;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
  ) {
    this.platformSecretKey =
      this.config.getOrThrow<string>('STRIPE_SECRET_KEY');
    this.stripe = new Stripe(this.platformSecretKey, {
      timeout: STRIPE_TIMEOUT_MS,
      maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
    });
  }

  getPlatformClient(): InstanceType<typeof Stripe> {
    return this.stripe;
  }

  clientForConnectedAccount(
    stripeAccountId: string,
  ): InstanceType<typeof Stripe> {
    return new Stripe(this.platformSecretKey, {
      stripeAccount: stripeAccountId.trim(),
      timeout: STRIPE_TIMEOUT_MS,
      maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
    });
  }

  /** Ensures Connect onboarding is complete before accepting payments. */
  async validateConnectedAccount(
    stripeAccountId: string,
  ): Promise<ValidatedConnectAccount> {
    const accountId = stripeAccountId?.trim();
    if (!accountId) {
      throw new BadRequestException('Missing Stripe connected account id.');
    }

    let account: Awaited<ReturnType<InstanceType<typeof Stripe>['accounts']['retrieve']>>;
    try {
      account = await this.stripe.accounts.retrieve(accountId);
    } catch (err) {
      errorStripePayment({
        phase: 'connect_account_retrieve',
        outcome: 'stripe_api_error',
        stripeAccountId: accountId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new BadRequestException(
        'Unable to verify Stripe account. Please reconnect Stripe in settings.',
      );
    }

    const chargesEnabled = account.charges_enabled === true;
    const detailsSubmitted = account.details_submitted === true;

    logStripePayment({
      phase: 'connect_account_validated',
      stripeAccountId: accountId,
      outcome: chargesEnabled && detailsSubmitted ? 'ready' : 'incomplete',
    });

    if (!chargesEnabled || !detailsSubmitted) {
      throw new BadRequestException(
        'Stripe onboarding is incomplete. Finish setup in Restaurant Settings before accepting payments.',
      );
    }

    return {
      id: accountId,
      chargesEnabled,
      detailsSubmitted,
    };
  }

  async connect(user: User, restaurantId: number): Promise<{ url: string }> {
    requireAdminRole(
      user,
      'You do not have permission to connect Stripe for this account.',
    );

    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId, owner: { id: user.id } },
      relations: ['owner'],
    });

    if (!restaurant) {
      throw new NotFoundException(
        'Restaurant not found or you do not own this restaurant.',
      );
    }

    let stripeAccountId = restaurant.stripeAccountId;

    if (!stripeAccountId) {
      const contactEmail = restaurant.email ?? restaurant.owner?.email;
      if (!contactEmail) {
        throw new InternalServerErrorException(
          'Restaurant must have an email (or owner email) before Stripe onboarding.',
        );
      }

      const account = await this.stripe.accounts.create({
        type: 'express',
        email: contactEmail,
        business_profile: {
          name: restaurant.name,
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });

      stripeAccountId = account.id;

      const persist = await this.restaurantRepository.update(
        { id: restaurantId, owner: { id: user.id } },
        { stripeAccountId },
      );

      if (!persist.affected) {
        throw new InternalServerErrorException(
          'Could not save Stripe account id on this restaurant.',
        );
      }
    }

    const frontendBase =
      process.env.CORS_ORIGIN ?? 'http://localhost:3000';

    const accountLink = await this.stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${frontendBase}/stripe/refresh`,
      return_url: `${frontendBase}/stripe/success`,
      type: 'account_onboarding',
    });

    return { url: accountLink.url };
  }

  async createDashboardLoginLink(
    stripeAccountId: string,
  ): Promise<{ url: string }> {
    const loginLink =
      await this.stripe.accounts.createLoginLink(stripeAccountId);
    return { url: loginLink.url };
  }

  async createPaymentIntentOnConnectedAccount(opts: {
    stripeAccountId: string;
    amount: number;
    currency: string;
    applicationFeeAmount: number;
    receiptEmail: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<
    Awaited<
      ReturnType<
        InstanceType<typeof Stripe>['paymentIntents']['create']
      >
    >
  > {
    await this.validateConnectedAccount(opts.stripeAccountId);

    const stripeForConnectedAccount = this.clientForConnectedAccount(
      opts.stripeAccountId,
    );

    logStripePayment({
      phase: 'payment_intent_create',
      stripeAccountId: opts.stripeAccountId,
      amount: opts.amount,
      currency: opts.currency,
      paymentId: opts.metadata.paymentId
        ? Number(opts.metadata.paymentId)
        : null,
      funnelId: opts.metadata.funnelId
        ? Number(opts.metadata.funnelId)
        : null,
      restaurantId: opts.metadata.restaurantId
        ? Number(opts.metadata.restaurantId)
        : null,
      campaignId: opts.metadata.campaignId
        ? Number(opts.metadata.campaignId)
        : null,
    });

    try {
      const intent = await stripeForConnectedAccount.paymentIntents.create(
        {
          amount: opts.amount,
          currency: opts.currency.toLowerCase(),
          automatic_payment_methods: { enabled: true },
          application_fee_amount: opts.applicationFeeAmount,
          receipt_email: opts.receiptEmail,
          metadata: opts.metadata,
        },
        { idempotencyKey: opts.idempotencyKey },
      );

      if (!intent.client_secret) {
        throw new InternalServerErrorException(
          'Stripe did not return a client secret for this payment intent.',
        );
      }

      logStripePayment({
        phase: 'payment_intent_created',
        outcome: 'success',
        paymentIntentId: intent.id,
        paymentId: opts.metadata.paymentId
          ? Number(opts.metadata.paymentId)
          : null,
        stripeAccountId: opts.stripeAccountId,
        amount: opts.amount,
        currency: opts.currency,
      });

      return intent;
    } catch (err) {
      errorStripePayment({
        phase: 'payment_intent_create',
        outcome: 'stripe_api_error',
        stripeAccountId: opts.stripeAccountId,
        amount: opts.amount,
        currency: opts.currency,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async retrievePaymentIntentOnConnectedAccount(
    stripeAccountId: string,
    paymentIntentId: string,
  ): Promise<
    Awaited<
      ReturnType<
        InstanceType<typeof Stripe>['paymentIntents']['retrieve']
      >
    >
  > {
    return this.clientForConnectedAccount(stripeAccountId).paymentIntents.retrieve(
      paymentIntentId,
    );
  }

  async createOAuthConnectUrl(
    restaurantId: number,
  ): Promise<{ url: string }> {
    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId },
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found.');
    }

    const clientId =
      this.config.get<string>('STRIPE_CONNECT_CLIENT_ID')?.trim() ||
      this.config.get<string>('STRIPE_CLIENT_ID')?.trim();
    if (!clientId) {
      throw new InternalServerErrorException(
        'Set STRIPE_CONNECT_CLIENT_ID or STRIPE_CLIENT_ID for Connect OAuth.',
      );
    }

    const redirectUri =
      this.config.get<string>('STRIPE_CONNECT_REDIRECT_URI')?.trim() ||
      this.config.get<string>('STRIPE_REDIRECT_URL')?.trim();
    if (!redirectUri) {
      throw new InternalServerErrorException(
        'Set STRIPE_CONNECT_REDIRECT_URI (or STRIPE_REDIRECT_URL) to your API URL for GET /stripe/callback/oauth.',
      );
    }

    const state = String(restaurantId);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: 'read_write',
      redirect_uri: redirectUri,
      state,
    });

    return {
      url: `https://connect.stripe.com/oauth/authorize?${params.toString()}`,
    };
  }

  async handleOAuthCallback(
    code: string,
    state: string,
  ): Promise<{ connected: boolean; stripeAccountId: string }> {
    const restaurantId = Number.parseInt(state, 10);

    if (!Number.isFinite(restaurantId) || restaurantId < 1) {
      throw new BadRequestException('Invalid Stripe OAuth state.');
    }

    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId },
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found.');
    }

    const tokenResponse = await this.stripe.oauth.token({
      grant_type: 'authorization_code',
      code,
    });

    const stripeAccountId = tokenResponse.stripe_user_id;

    if (!stripeAccountId) {
      throw new BadRequestException('Stripe account connection failed.');
    }

    await this.restaurantRepository.update(restaurantId, {
      stripeAccountId,
    });

    return {
      connected: true,
      stripeAccountId,
    };
  }
}
