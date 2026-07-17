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
import { Business } from '../../db/entities/business.entity';
import { User } from '../../db/entities/user.entity';
import { getFrontendBaseUrl } from '../../utils/frontend-base-url';
import { requireAdminRole } from '../../utils/require-admin-role';
import { businessAccessWhere } from '../../utils/business-access';
import {
  errorStripePayment,
  logStripePayment,
  warnStripePayment,
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
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
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
        'Stripe onboarding is incomplete. Finish setup in Business Settings before accepting payments.',
      );
    }

    return {
      id: accountId,
      chargesEnabled,
      detailsSubmitted,
    };
  }

  async connect(user: User, businessId: number): Promise<{ url: string }> {
    requireAdminRole(
      user,
      'You do not have permission to connect Stripe for this account.',
    );

    const business = await this.businessRepository.findOne({
      where: businessAccessWhere(user, businessId),
    });

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    return this.createOAuthConnectUrl(businessId);
  }

  async disconnectStripeForBusiness(
    user: User,
    businessId: number,
  ): Promise<{ disconnected: true }> {
    requireAdminRole(
      user,
      'You do not have permission to disconnect Stripe for this account.',
    );

    const business = await this.businessRepository.findOne({
      where: businessAccessWhere(user, businessId),
    });

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    const stripeAccountId = business.stripeAccountId?.trim();
    if (!stripeAccountId) {
      throw new BadRequestException(
        'Stripe is not connected for this business.',
      );
    }

    const clientId =
      this.config.get<string>('STRIPE_CONNECT_CLIENT_ID')?.trim() ||
      this.config.get<string>('STRIPE_CLIENT_ID')?.trim();

    if (clientId) {
      try {
        await this.stripe.oauth.deauthorize({
          client_id: clientId,
          stripe_user_id: stripeAccountId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnStripePayment({
          phase: 'stripe_disconnect',
          businessId,
          stripeAccountId,
          outcome: 'deauthorize_skipped',
          error: message,
        });
      }
    }

    await this.businessRepository.update(businessId, {
      stripeAccountId: null,
    });

    logStripePayment({
      phase: 'stripe_disconnect',
      businessId,
      stripeAccountId,
      outcome: 'disconnected',
    });

    return { disconnected: true };
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
      businessId: opts.metadata.businessId
        ? Number(opts.metadata.businessId)
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
          ...(opts.applicationFeeAmount > 0
            ? { application_fee_amount: opts.applicationFeeAmount }
            : {}),
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


  async createCheckoutSessionOnConnectedAccount(opts: {
    stripeAccountId: string;
    stripePriceId: string;
    returnUrl: string;
    customerEmail: string;
    applicationFeeAmount: number;
    currency?: string;
    description?: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
    paymentId?: number;
    funnelId?: number;
    businessId?: number;
    campaignId?: number;
  }): Promise<
    Awaited<
      ReturnType<InstanceType<typeof Stripe>['checkout']['sessions']['create']>
    >
  > {
    await this.validateConnectedAccount(opts.stripeAccountId);

    const stripeForConnectedAccount = this.clientForConnectedAccount(
      opts.stripeAccountId,
    );


    const paymentMethodTypes: Array<'card'> = ['card'];

    logStripePayment({
      phase: 'checkout_session_create',
      stripeAccountId: opts.stripeAccountId,
      paymentId: opts.paymentId ?? null,
      funnelId: opts.funnelId ?? null,
      businessId: opts.businessId ?? null,
      campaignId: opts.campaignId ?? null,
      paymentMethodTypes,
    });

    try {
      const session = await stripeForConnectedAccount.checkout.sessions.create(
        {
          mode: 'payment',
          ui_mode: 'elements',

          payment_method_types: paymentMethodTypes,

          allow_promotion_codes: false,

          line_items: [{ price: opts.stripePriceId.trim(), quantity: 1 }],

          customer_email: opts.customerEmail.trim().toLowerCase(),
          return_url: opts.returnUrl,
          metadata: opts.metadata,
          payment_intent_data: {
            ...(opts.applicationFeeAmount > 0
              ? { application_fee_amount: opts.applicationFeeAmount }
              : {}),
            ...(opts.description?.trim()
              ? { description: opts.description.trim().slice(0, 1000) }
              : {}),
            metadata: opts.metadata,
          },
        },
        { idempotencyKey: opts.idempotencyKey },
      );

      if (!session.client_secret) {
        throw new InternalServerErrorException(
          'Stripe did not return a client secret for this checkout session.',
        );
      }

      logStripePayment({
        phase: 'checkout_session_created',
        outcome: 'success',
        paymentId: opts.paymentId ?? null,
        stripeAccountId: opts.stripeAccountId,
        checkoutSessionId: session.id,
        paymentIntentId:
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id ?? null,
      });

      return session;
    } catch (err) {
      errorStripePayment({
        phase: 'checkout_session_create',
        outcome: 'stripe_api_error',
        stripeAccountId: opts.stripeAccountId,
        paymentId: opts.paymentId ?? null,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async retrieveCheckoutSessionOnConnectedAccount(
    stripeAccountId: string,
    checkoutSessionId: string,
  ): Promise<
    Awaited<
      ReturnType<
        InstanceType<typeof Stripe>['checkout']['sessions']['retrieve']
      >
    >
  > {
    return this.clientForConnectedAccount(
      stripeAccountId,
    ).checkout.sessions.retrieve(checkoutSessionId.trim(), {
      expand: ['payment_intent'],
    });
  }


  async expireCheckoutSessionOnConnectedAccount(
    stripeAccountId: string,
    checkoutSessionId: string,
  ): Promise<void> {
    await this.clientForConnectedAccount(
      stripeAccountId,
    ).checkout.sessions.expire(checkoutSessionId.trim());
  }


  async createProductAndPriceOnConnectedAccount(opts: {
    stripeAccountId: string;
    name: string;
    description?: string;
    imageUrl?: string | null;
    websiteUrl?: string | null;
    unitAmount: number;
    currency: string;
    metadata?: Record<string, string>;
  }): Promise<{ stripeProductId: string; stripePriceId: string }> {
    await this.validateConnectedAccount(opts.stripeAccountId);

    const name = opts.name.trim().slice(0, 250);
    if (!name) {
      throw new BadRequestException('Stripe product name is required.');
    }
    if (!Number.isFinite(opts.unitAmount) || opts.unitAmount < 1) {
      throw new BadRequestException('Stripe price amount is invalid.');
    }

    const currency = opts.currency.trim().toLowerCase() || 'usd';
    const stripeForConnectedAccount = this.clientForConnectedAccount(
      opts.stripeAccountId,
    );


    const images = this.stripeProductImages(opts.imageUrl);
    const productUrl = this.stripeProductUrl(opts.websiteUrl);
    const description = opts.description?.trim().slice(0, 1000) || undefined;
    const metadata = this.sanitizeStripeMetadata(opts.metadata);

    logStripePayment({
      phase: 'connect_product_create',
      stripeAccountId: opts.stripeAccountId,
      unitAmount: opts.unitAmount,
      currency,
      productName: name,
    });

    try {
      const product = await stripeForConnectedAccount.products.create({
        name,
        active: true,
        ...(description ? { description } : {}),
        ...(images.length > 0 ? { images } : {}),
        ...(productUrl ? { url: productUrl } : {}),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),

        default_price_data: {
          currency,
          unit_amount: opts.unitAmount,
        },
      });

      const defaultPrice =
        typeof product.default_price === 'string'
          ? product.default_price
          : product.default_price?.id;

      if (!defaultPrice?.trim()) {
        throw new InternalServerErrorException(
          'Stripe product was created without a default price.',
        );
      }

      logStripePayment({
        phase: 'connect_product_created',
        outcome: 'success',
        stripeAccountId: opts.stripeAccountId,
        stripeProductId: product.id,
        stripePriceId: defaultPrice,
      });

      return {
        stripeProductId: product.id,
        stripePriceId: defaultPrice.trim(),
      };
    } catch (err) {
      errorStripePayment({
        phase: 'connect_product_create',
        outcome: 'stripe_api_error',
        stripeAccountId: opts.stripeAccountId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async retrievePriceOnConnectedAccount(
    stripeAccountId: string,
    stripePriceId: string,
  ): Promise<
    Awaited<ReturnType<InstanceType<typeof Stripe>['prices']['retrieve']>>
  > {
    return this.clientForConnectedAccount(stripeAccountId).prices.retrieve(
      stripePriceId.trim(),
      { expand: ['product'] },
    );
  }


  private stripeProductImages(imageUrl?: string | null): string[] {
    const url = imageUrl?.trim();
    if (!url || !/^https:\/\//i.test(url)) return [];
    return [url.slice(0, 2048)];
  }


  private stripeProductUrl(websiteUrl?: string | null): string | undefined {
    const url = websiteUrl?.trim();
    if (!url || !/^https?:\/\//i.test(url)) return undefined;
    return url.slice(0, 2048);
  }

  private sanitizeStripeMetadata(
    metadata?: Record<string, string>,
  ): Record<string, string> {
    if (!metadata) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(metadata)) {
      const k = key.trim().slice(0, 40);
      const v = String(value ?? '')
        .trim()
        .slice(0, 500);
      if (k && v) out[k] = v;
    }
    return out;
  }

  async createPlatformSubscriptionCheckoutSession(opts: {
    userId: number;
    userEmail: string;
    userName: string;
    stripeCustomerId: string | null;
    priceId: string;
    planSlug: string;
    billingCycle: 'monthly' | 'annual';
  }): Promise<{ url: string; sessionId: string; stripeCustomerId: string }> {
    const frontendBase = getFrontendBaseUrl();
    let stripeCustomerId = opts.stripeCustomerId?.trim() || null;

    if (!stripeCustomerId) {
      const customer = await this.stripe.customers.create({
        email: opts.userEmail.trim(),
        name: opts.userName.trim() || undefined,
        metadata: {
          userId: String(opts.userId),
          purpose: 'platform_subscription',
        },
      });
      stripeCustomerId = customer.id;
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{ price: opts.priceId, quantity: 1 }],
      success_url: `${frontendBase}/auth/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendBase}/auth/select-plan?cancelled=1`,
      client_reference_id: String(opts.userId),
      metadata: {
        userId: String(opts.userId),
        planSlug: opts.planSlug,
        billingCycle: opts.billingCycle,
        purpose: 'platform_subscription',
      },
      subscription_data: {
        metadata: {
          userId: String(opts.userId),
          planSlug: opts.planSlug,
          billingCycle: opts.billingCycle,
          purpose: 'platform_subscription',
        },
      },
    });

    if (!session.url) {
      throw new InternalServerErrorException(
        'Stripe did not return a checkout URL.',
      );
    }

    return {
      url: session.url,
      sessionId: session.id,
      stripeCustomerId,
    };
  }

  async retrievePlatformCheckoutSession(
    sessionId: string,
  ): Promise<
    Awaited<
      ReturnType<
        InstanceType<typeof Stripe>['checkout']['sessions']['retrieve']
      >
    >
  > {
    return this.stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });
  }

  async retrievePlatformPrice(
    priceId: string,
  ): Promise<
    Awaited<ReturnType<InstanceType<typeof Stripe>['prices']['retrieve']>>
  > {
    try {
      return await this.stripe.prices.retrieve(priceId.trim());
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'type' in err &&
        (err as { type?: string }).type === 'StripeInvalidRequestError'
      ) {
        throw new NotFoundException('Stripe price not found.');
      }
      throw err;
    }
  }

  async updatePlatformSubscriptionPrice(opts: {
    stripeSubscriptionId: string;
    newPriceId: string;
    metadata?: Record<string, string>;
  }): Promise<{
    subscription: Awaited<
      ReturnType<InstanceType<typeof Stripe>['subscriptions']['update']>
    >;
    oldPriceId: string;
    newPriceId: string;
    paymentIntentClientSecret: string | null;
  }> {
    const subscriptionId = opts.stripeSubscriptionId.trim();
    const newPriceId = opts.newPriceId.trim();

    let subscription: Awaited<
      ReturnType<InstanceType<typeof Stripe>['subscriptions']['retrieve']>
    >;
    try {
      subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['items.data.price'],
      });
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'type' in err &&
        (err as { type?: string }).type === 'StripeInvalidRequestError'
      ) {
        throw new NotFoundException('Stripe subscription not found.');
      }
      throw err;
    }

    const item = subscription.items.data[0];
    if (!item?.id) {
      throw new BadRequestException(
        'Stripe subscription has no billable items to update.',
      );
    }

    const oldPrice =
      typeof item.price === 'string' ? item.price : item.price?.id;
    if (!oldPrice) {
      throw new BadRequestException(
        'Could not resolve the current Stripe price on this subscription.',
      );
    }

    if (oldPrice === newPriceId) {
      throw new BadRequestException('You are already on the requested plan.');
    }

    if (
      subscription.status === 'canceled' ||
      subscription.status === 'incomplete_expired'
    ) {
      throw new BadRequestException(
        'This subscription is cancelled. Start a new checkout to subscribe again.',
      );
    }

    const quantity = item.quantity ?? 1;

    let updated: Awaited<
      ReturnType<InstanceType<typeof Stripe>['subscriptions']['update']>
    >;
    try {
      updated = await this.stripe.subscriptions.update(subscriptionId, {
        items: [
          {
            id: item.id,
            price: newPriceId,
            quantity,
          },
        ],
        proration_behavior: 'always_invoice',
        metadata: {
          ...(subscription.metadata ?? {}),
          ...(opts.metadata ?? {}),
          purpose: 'platform_subscription',
        },
        expand: ['latest_invoice.payment_intent'],
      });
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'type' in err &&
        (err as { type?: string }).type === 'StripeCardError'
      ) {
        throw new BadRequestException(
          (err as { message?: string }).message ||
            'Card was declined while updating the subscription.',
        );
      }
      if (
        err &&
        typeof err === 'object' &&
        'type' in err &&
        (err as { type?: string }).type === 'StripeInvalidRequestError'
      ) {
        throw new BadRequestException(
          (err as { message?: string }).message ||
            'Unable to update the Stripe subscription.',
        );
      }
      throw err;
    }

    const paymentIntentClientSecret =
      this.extractPaymentIntentClientSecret(updated.latest_invoice);

    return {
      subscription: updated,
      oldPriceId: oldPrice,
      newPriceId,
      paymentIntentClientSecret,
    };
  }

  private extractPaymentIntentClientSecret(
    latestInvoice: unknown,
  ): string | null {
    if (!latestInvoice || typeof latestInvoice === 'string') {
      return null;
    }

    const invoice = latestInvoice as {
      payment_intent?: string | { status?: string; client_secret?: string | null } | null;
    };
    const paymentIntent = invoice.payment_intent;
    if (!paymentIntent || typeof paymentIntent === 'string') {
      return null;
    }

    if (
      paymentIntent.status === 'requires_action' ||
      paymentIntent.status === 'requires_confirmation'
    ) {
      return paymentIntent.client_secret ?? null;
    }

    return null;
  }

  async createOAuthConnectUrl(
    businessId: number,
  ): Promise<{ url: string }> {
    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });

    if (!business) {
      throw new NotFoundException('Business not found.');
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

    const state = String(businessId);

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
    const businessId = Number.parseInt(state, 10);

    if (!Number.isFinite(businessId) || businessId < 1) {
      throw new BadRequestException('Invalid Stripe OAuth state.');
    }

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });

    if (!business) {
      throw new NotFoundException('Business not found.');
    }

    const tokenResponse = await this.stripe.oauth.token({
      grant_type: 'authorization_code',
      code,
    });

    const stripeAccountId = tokenResponse.stripe_user_id;

    if (!stripeAccountId) {
      throw new BadRequestException('Stripe account connection failed.');
    }

    await this.businessRepository.update(businessId, {
      stripeAccountId,
    });

    return {
      connected: true,
      stripeAccountId,
    };
  }
}
