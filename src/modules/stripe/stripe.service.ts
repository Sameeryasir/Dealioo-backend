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
    this.stripe = new Stripe(this.platformSecretKey);
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
    metadata?: Record<string, string>;
  }) {
    const stripeAccountId = opts.stripeAccountId?.trim();
    if (!stripeAccountId) {
      throw new BadRequestException('Missing Stripe connected account id.');
    }

    const stripeForConnectedAccount = new Stripe(this.platformSecretKey, {
      stripeAccount: stripeAccountId,
    });

    const intent = await stripeForConnectedAccount.paymentIntents.create({
      amount: opts.amount,
      currency: opts.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      application_fee_amount: opts.applicationFeeAmount,
      receipt_email: opts.receiptEmail,
      metadata: opts.metadata ?? {},
    });

    if (!intent.client_secret) {
      throw new InternalServerErrorException(
        'Stripe did not return a client secret for this payment intent.',
      );
    }

    return intent;
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
