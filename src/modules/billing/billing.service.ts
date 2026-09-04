import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SubscriptionPlan } from '../../db/entities/subscription-plan.entity';
import { User } from '../../db/entities/user.entity';
import {
  UserSubscription,
  type UserSubscriptionBillingCycle,
} from '../../db/entities/user-subscription.entity';
import { StripeService } from '../stripe/stripe.service';
import type { ConfirmPaymentMethodDto } from './dto/confirm-payment-method.dto';
import type { UpdateBillingDetailsDto } from './dto/update-billing-details.dto';
import type { UpgradeSubscriptionDto } from './dto/upgrade-subscription.dto';
import { buildDealiooInvoicePdf } from './invoice-pdf';
import type {
  BillingAddress,
  BillingDetails,
  BillingDetailsUpdateResponse,
  BillingInvoice,
  BillingInvoiceLinksResponse,
  BillingInvoicePdfFile,
  BillingOverviewResponse,
  BillingPaymentMethod,
  BillingPaymentMethodUpdateResponse,
  BillingPortalResponse,
  BillingSetupIntentResponse,
  BillingSubscriptionSummary,
  ResumeSubscriptionResponse,
  UpgradeSubscriptionResponse,
} from './billing.types';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserSubscription)
    private readonly subscriptionRepository: Repository<UserSubscription>,
    @InjectRepository(SubscriptionPlan)
    private readonly planRepository: Repository<SubscriptionPlan>,
    private readonly stripeService: StripeService,
  ) {}

  async getOverview(userId: number): Promise<BillingOverviewResponse> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, name: true, email: true, stripeCustomerId: true },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const localSub = await this.subscriptionRepository.findOne({
      where: {
        userId,
        status: In(['active', 'trialing', 'past_due']),
      },
      relations: ['plan'],
      order: { createdAt: 'DESC' },
    });

    const fallbackDetails: BillingDetails = {
      name: user.name?.trim() || null,
      email: user.email?.trim() || null,
      address: null,
    };

    const stripeCustomerId =
      user.stripeCustomerId?.trim() ||
      localSub?.stripeCustomerId?.trim() ||
      '';

    if (!stripeCustomerId) {
      this.logger.warn(`No Stripe customer id for user ${userId}.`);
      return {
        subscription: this.toLocalSubscriptionSummary(localSub),
        paymentMethod: null,
        billingDetails: fallbackDetails,
        invoices: [],
      };
    }

    const [customer, invoicesList, paymentMethods] = await Promise.all([
      this.stripeService.retrievePlatformCustomer(stripeCustomerId),
      this.stripeService.listPlatformInvoices(stripeCustomerId),
      this.stripeService.listPlatformCardPaymentMethods(stripeCustomerId),
    ]);

    if ('deleted' in customer && customer.deleted) {
      throw new BadRequestException('Billing customer is no longer available.');
    }

    let stripeSubscription: Awaited<
      ReturnType<StripeService['retrievePlatformSubscription']>
    > | null = null;
    if (localSub?.stripeSubscriptionId?.trim()) {
      try {
        stripeSubscription =
          await this.stripeService.retrievePlatformSubscription({
            stripeSubscriptionId: localSub.stripeSubscriptionId,
          });
      } catch (error) {
        this.logger.error(
          `Failed to retrieve Stripe subscription ${localSub.stripeSubscriptionId}`,
          error instanceof Error ? error.stack : String(error),
        );
        stripeSubscription = null;
      }
    }

    if (localSub?.id && stripeSubscription?.status) {
      const mapped = this.mapStripeStatus(stripeSubscription.status);
      if (mapped && mapped !== localSub.status) {
        await this.subscriptionRepository.update(localSub.id, {
          status: mapped,
          ...(typeof stripeSubscription.cancel_at_period_end === 'boolean'
            ? { cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end }
            : {}),
        });
        localSub.status = mapped;
      }
    }

    const billingDetails = this.mapBillingDetails(customer, fallbackDetails);
    const paymentMethod = this.resolvePaymentMethod(
      stripeSubscription,
      customer,
      paymentMethods.data,
    );

    return {
      subscription: this.toSubscriptionSummary(localSub, stripeSubscription),
      paymentMethod,
      billingDetails,
      invoices: invoicesList.data.map((invoice) => this.mapInvoice(invoice)),
    };
  }

  async createSetupIntent(userId: number): Promise<BillingSetupIntentResponse> {
    const { stripeCustomerId } = await this.requireStripeCustomer(userId);
    const { clientSecret } = await this.stripeService.createPlatformSetupIntent({
      stripeCustomerId,
      userId,
    });
    return { clientSecret };
  }

  async confirmPaymentMethod(
    userId: number,
    dto: ConfirmPaymentMethodDto,
  ): Promise<BillingPaymentMethodUpdateResponse> {
    const { stripeCustomerId, localSub } =
      await this.requireStripeCustomer(userId);

    const setupIntent = await this.stripeService.retrievePlatformSetupIntent(
      dto.setupIntentId,
    );

    const setupCustomerId =
      typeof setupIntent.customer === 'string'
        ? setupIntent.customer
        : setupIntent.customer?.id ?? '';

    if (setupCustomerId !== stripeCustomerId) {
      throw new BadRequestException('This card setup does not belong to you.');
    }

    const setupUserId = setupIntent.metadata?.userId?.trim() || '';
    if (setupUserId && setupUserId !== String(userId)) {
      throw new BadRequestException('This card setup does not belong to you.');
    }

    if (setupIntent.status !== 'succeeded') {
      throw new BadRequestException(
        'Card setup is not complete yet. Please try again.',
      );
    }

    const paymentMethodId =
      typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent.payment_method?.id ?? '';

    if (!paymentMethodId) {
      throw new BadRequestException('Stripe did not return a payment method.');
    }

    await this.stripeService.setDefaultPlatformPaymentMethod({
      stripeCustomerId,
      paymentMethodId,
      stripeSubscriptionId: localSub?.stripeSubscriptionId ?? null,
    });

    const paymentMethods =
      await this.stripeService.listPlatformCardPaymentMethods(stripeCustomerId);
    const paymentMethod =
      this.mapPaymentMethod(
        paymentMethods.data.find((item) => item.id === paymentMethodId) ??
          paymentMethods.data[0] ??
          null,
      ) ?? null;

    return { success: true, paymentMethod };
  }

  async updateBillingDetails(
    userId: number,
    dto: UpdateBillingDetailsDto,
  ): Promise<BillingDetailsUpdateResponse> {
    const { stripeCustomerId } = await this.requireStripeCustomer(userId);
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const accountEmail = user.email.trim();
    const requestedEmail = dto.email?.trim() || '';
    if (
      requestedEmail &&
      requestedEmail.toLowerCase() !== accountEmail.toLowerCase()
    ) {
      throw new BadRequestException(
        'Invoices are sent to your Dealioo account email. Change that in Account settings.',
      );
    }

    const customer = await this.stripeService.updatePlatformCustomerBilling({
      stripeCustomerId,
      name: dto.name,
      email: accountEmail,
      address: dto.address,
    });

    return {
      success: true,
      billingDetails: this.mapBillingDetails(customer, {
        name: user?.name?.trim() || null,
        email: user?.email?.trim() || null,
        address: null,
      }),
    };
  }

  async resumeSubscription(
    userId: number,
  ): Promise<ResumeSubscriptionResponse> {
    const localSub = await this.subscriptionRepository.findOne({
      where: {
        userId,
        status: In(['active', 'trialing', 'past_due']),
      },
      order: { createdAt: 'DESC' },
    });

    if (!localSub?.stripeSubscriptionId?.trim()) {
      throw new BadRequestException('No active subscription was found.');
    }

    if (!localSub.cancelAtPeriodEnd) {
      return {
        success: true,
        cancelAtPeriodEnd: false,
        status: localSub.status,
      };
    }

    const updated = await this.stripeService.resumePlatformSubscription({
      stripeSubscriptionId: localSub.stripeSubscriptionId,
    });

    await this.subscriptionRepository.update(localSub.id, {
      cancelAtPeriodEnd: false,
      cancelRequestedAt: null,
      cancellationReason: null,
      cancellationComment: null,
      cancelsAt: null,
    });

    return {
      success: true,
      cancelAtPeriodEnd: false,
      status: updated.status,
    };
  }

  async createBillingPortalSession(
    userId: number,
  ): Promise<BillingPortalResponse> {
    const { stripeCustomerId } = await this.requireStripeCustomer(userId);
    return this.stripeService.createPlatformBillingPortalSession({
      stripeCustomerId,
    });
  }

  async getInvoiceLinks(
    userId: number,
    invoiceId: string,
  ): Promise<BillingInvoiceLinksResponse> {
    const invoice = await this.requireOwnedStripeInvoice(userId, invoiceId);
    const hostedInvoiceUrl = invoice.hosted_invoice_url?.trim() || null;
    const invoicePdfUrl = invoice.invoice_pdf?.trim() || null;
    if (!hostedInvoiceUrl && !invoicePdfUrl) {
      throw new NotFoundException('Invoice is not available.');
    }

    return { hostedInvoiceUrl, invoicePdfUrl };
  }

  async downloadInvoicePdf(
    userId: number,
    invoiceId: string,
  ): Promise<BillingInvoicePdfFile> {
    const invoice = await this.requireOwnedStripeInvoice(userId, invoiceId);
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });

    const amountCents =
      invoice.status === 'paid'
        ? (invoice.amount_paid ?? invoice.amount_due ?? 0)
        : (invoice.amount_due ?? invoice.amount_paid ?? 0);
    const currency = invoice.currency || 'usd';
    const totalAmount = this.formatMoney(amountCents, currency, true);

    const lineItems = (invoice.lines?.data ?? [])
      .map((item) => {
        const description =
          item.description?.trim() ||
          invoice.description?.trim() ||
          'Dealioo subscription';
        return {
          description,
          amount: this.formatMoney(item.amount ?? 0, currency, true),
        };
      })
      .filter((item) => item.description);

    const lines =
      lineItems.length > 0
        ? lineItems
        : [{ description: 'Dealioo subscription', amount: totalAmount }];

    const address = invoice.customer_address;
    const billToAddress = [
      address?.line1?.trim() || '',
      address?.line2?.trim() || '',
      [address?.city, address?.state, address?.postal_code]
        .map((part) => part?.trim() || '')
        .filter(Boolean)
        .join(', '),
      address?.country?.trim() || '',
    ].filter(Boolean);

    const buffer = buildDealiooInvoicePdf({
      number: invoice.number?.trim() || invoice.id,
      issuedAt: this.formatInvoiceDate(invoice.created),
      status: this.formatInvoiceStatus(invoice.status),
      billToName:
        invoice.customer_name?.trim() || user?.name?.trim() || 'Dealioo customer',
      billToEmail: invoice.customer_email?.trim() || user?.email?.trim() || '',
      billToAddress,
      lines,
      totalAmount,
    });

    return {
      buffer,
      filename: this.toInvoicePdfFilename(invoice.number, invoice.id),
    };
  }

  private async requireOwnedStripeInvoice(userId: number, invoiceId: string) {
    const { stripeCustomerId } = await this.requireStripeCustomer(userId);
    const invoice = await this.stripeService.retrievePlatformInvoice({
      stripeInvoiceId: invoiceId,
    });

    const invoiceCustomerId =
      typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id ?? '';
    if (invoiceCustomerId !== stripeCustomerId) {
      throw new ForbiddenException('This invoice does not belong to you.');
    }

    return invoice;
  }

  private toInvoicePdfFilename(
    invoiceNumber: string | null | undefined,
    invoiceId: string,
  ): string {
    const raw = invoiceNumber?.trim() || invoiceId.replace(/^in_/, '').slice(-8);
    const safe = raw.replace(/[^A-Za-z0-9._-]/g, '-') || 'invoice';
    return `Invoice-${safe}.pdf`;
  }

  private formatInvoiceDate(unixSeconds: number | null | undefined): string {
    const iso = this.toIsoFromUnixSeconds(unixSeconds);
    if (!iso) return '';
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(iso));
  }

  private formatInvoiceStatus(status: string | null | undefined): string {
    const value = status?.trim() || 'unknown';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  private async requireStripeCustomer(userId: number): Promise<{
    stripeCustomerId: string;
    localSub: UserSubscription | null;
  }> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, stripeCustomerId: true },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const localSub = await this.subscriptionRepository.findOne({
      where: {
        userId,
        status: In(['active', 'trialing', 'past_due']),
      },
      order: { createdAt: 'DESC' },
    });

    const stripeCustomerId =
      user.stripeCustomerId?.trim() ||
      localSub?.stripeCustomerId?.trim() ||
      '';

    if (!stripeCustomerId) {
      throw new BadRequestException('No billing customer found');
    }

    return { stripeCustomerId, localSub };
  }

  async upgradeSubscription(
    userId: number,
    dto: UpgradeSubscriptionDto,
  ): Promise<UpgradeSubscriptionResponse> {
    const { targetPlan, newPriceId, billingCycle } =
      await this.resolveUpgradeTarget(dto);

    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, stripeCustomerId: true },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const localSub = await this.subscriptionRepository.findOne({
      where: {
        userId,
        status: In(['active', 'trialing', 'past_due']),
      },
      order: { createdAt: 'DESC' },
    });

    if (!localSub?.stripeSubscriptionId) {
      throw new NotFoundException(
        'No active Stripe subscription found for this account.',
      );
    }

    if (localSub.status === 'cancelled') {
      throw new BadRequestException(
        'This subscription is cancelled. Start a new checkout to subscribe again.',
      );
    }

    await this.stripeService.retrievePlatformPrice(newPriceId);

    const updated = await this.stripeService.updatePlatformSubscriptionPrice({
      stripeSubscriptionId: localSub.stripeSubscriptionId,
      newPriceId,
      metadata: {
        userId: String(userId),
        planSlug: targetPlan.slug,
        billingCycle,
        purpose: 'platform_subscription',
      },
    });

    const mappedStatus = this.mapStripeStatus(updated.subscription.status);
    const requiresAction = Boolean(updated.paymentIntentClientSecret);
    await this.subscriptionRepository.update(localSub.id, {
      planId: targetPlan.id,
      billingCycle,
      ...(mappedStatus
        ? { status: requiresAction ? 'past_due' : mappedStatus }
        : requiresAction
          ? { status: 'past_due' }
          : {}),
      cancelAtPeriodEnd: false,
      cancelRequestedAt: null,
      cancellationReason: null,
      cancellationComment: null,
      cancelsAt: null,
    });

    const customerId =
      typeof updated.subscription.customer === 'string'
        ? updated.subscription.customer
        : updated.subscription.customer?.id ??
          localSub.stripeCustomerId ??
          user.stripeCustomerId ??
          null;

    const latestInvoice =
      typeof updated.subscription.latest_invoice === 'string'
        ? updated.subscription.latest_invoice
        : updated.subscription.latest_invoice?.id ?? null;

    return {
      success: true,
      subscriptionId: updated.subscription.id,
      customerId,
      oldPriceId: updated.oldPriceId,
      newPriceId: updated.newPriceId,
      status: updated.subscription.status,
      latestInvoice,
      paymentIntentClientSecret: updated.paymentIntentClientSecret,
    };
  }

  private async resolveUpgradeTarget(dto: UpgradeSubscriptionDto): Promise<{
    targetPlan: SubscriptionPlan;
    newPriceId: string;
    billingCycle: UserSubscriptionBillingCycle;
  }> {
    const priceId = dto.priceId?.trim() || '';
    const planSlug = dto.planSlug?.trim().toLowerCase() || '';
    const billingCycle = dto.billingCycle;

    if (priceId) {
      const targetPlan = await this.findPlanByStripePriceId(priceId);
      if (!targetPlan) {
        throw new BadRequestException(
          'This Stripe price is not linked to an active Dealioo plan.',
        );
      }
      return {
        targetPlan,
        newPriceId: priceId,
        billingCycle: this.resolveBillingCycleForPrice(targetPlan, priceId),
      };
    }

    if (!planSlug || !billingCycle) {
      throw new BadRequestException(
        'Provide priceId, or planSlug with billingCycle (monthly|annual).',
      );
    }

    const targetPlan = await this.planRepository.findOne({
      where: { slug: planSlug, isActive: true },
    });
    if (!targetPlan) {
      throw new NotFoundException('Subscription plan not found.');
    }

    const newPriceId = this.resolveStripePriceId(targetPlan, billingCycle);
    if (!newPriceId) {
      throw new BadRequestException(
        billingCycle === 'annual'
          ? 'Annual billing is not available for this plan yet. Choose monthly or contact sales.'
          : 'This plan is not available for online upgrade. Please contact sales.',
      );
    }

    return { targetPlan, newPriceId, billingCycle };
  }

  private async findPlanByStripePriceId(
    priceId: string,
  ): Promise<SubscriptionPlan | null> {
    return this.planRepository
      .createQueryBuilder('plan')
      .where('plan.isActive = true')
      .andWhere(
        '(plan.stripeMonthlyPriceId = :priceId OR plan.stripeYearlyPriceId = :priceId)',
        { priceId },
      )
      .getOne();
  }

  private resolveStripePriceId(
    plan: SubscriptionPlan,
    billingCycle: UserSubscriptionBillingCycle,
  ): string | null {
    if (billingCycle === 'annual') {
      return plan.stripeYearlyPriceId?.trim() || null;
    }
    return plan.stripeMonthlyPriceId?.trim() || null;
  }

  private resolveBillingCycleForPrice(
    plan: SubscriptionPlan,
    priceId: string,
  ): UserSubscriptionBillingCycle {
    if (plan.stripeYearlyPriceId?.trim() === priceId) {
      return 'annual';
    }
    return 'monthly';
  }

  private mapStripeStatus(
    status: string | null | undefined,
  ): UserSubscription['status'] | null {
    switch (status) {
      case 'active':
        return 'active';
      case 'trialing':
        return 'trialing';
      case 'past_due':
      case 'unpaid':
        return 'past_due';
      case 'canceled':
        return 'cancelled';
      default:
        return null;
    }
  }

  private toLocalSubscriptionSummary(
    localSub: UserSubscription | null,
  ): BillingSubscriptionSummary | null {
    if (!localSub?.plan) return null;
    return {
      planName: localSub.plan.name,
      planSlug: localSub.plan.slug,
      billingCycle: localSub.billingCycle,
      status: localSub.status,
      priceFormatted: this.formatLocalPlanPrice(localSub),
      nextBillingDate: null,
      cancelAtPeriodEnd: Boolean(localSub.cancelAtPeriodEnd),
      cancellationDate: localSub.cancelsAt?.toISOString() ?? null,
      startedAt: localSub.startedAt?.toISOString() ?? null,
    };
  }

  private toSubscriptionSummary(
    localSub: UserSubscription | null,
    stripeSubscription: Awaited<
      ReturnType<StripeService['retrievePlatformSubscription']>
    > | null,
  ): BillingSubscriptionSummary | null {
    if (!localSub?.plan && !stripeSubscription) return null;

    const item = stripeSubscription?.items?.data?.[0];
    const price = item?.price;
    const priceObject = price && typeof price !== 'string' ? price : null;
    const nextBillingUnix = item?.current_period_end ?? null;
    const cancelAtPeriodEnd = Boolean(
      stripeSubscription?.cancel_at_period_end ?? localSub?.cancelAtPeriodEnd,
    );
    const cancellationUnix =
      stripeSubscription?.cancel_at ??
      (cancelAtPeriodEnd ? nextBillingUnix : null);

    return {
      planName: localSub?.plan?.name || 'Dealioo plan',
      planSlug: localSub?.plan?.slug || '',
      billingCycle: localSub?.billingCycle ?? 'monthly',
      status: this.mapStripeStatus(stripeSubscription?.status) ?? localSub?.status ?? 'active',
      priceFormatted:
        this.formatStripePrice(priceObject) ??
        this.formatLocalPlanPrice(localSub),
      nextBillingDate: this.toIsoFromUnixSeconds(nextBillingUnix),
      cancelAtPeriodEnd,
      cancellationDate:
        this.toIsoFromUnixSeconds(cancellationUnix) ??
        localSub?.cancelsAt?.toISOString() ??
        null,
      startedAt: localSub?.startedAt?.toISOString() ?? null,
    };
  }

  private formatLocalPlanPrice(
    localSub: UserSubscription | null,
  ): string | null {
    if (!localSub?.plan) return null;
    const amount =
      localSub.billingCycle === 'annual'
        ? localSub.plan.yearlyPrice
        : localSub.plan.monthlyPrice;
    if (amount == null || Number.isNaN(Number(amount))) return null;
    const currency = localSub.plan.currency?.trim() || 'USD';
    return this.formatMoney(Number(amount), currency, false);
  }

  private formatStripePrice(
    price: { unit_amount?: number | null; currency?: string | null } | null,
  ): string | null {
    if (price?.unit_amount == null) return null;
    return this.formatMoney(price.unit_amount, price.currency || 'usd', true);
  }

  private formatMoney(
    amount: number,
    currency: string,
    amountInCents: boolean,
  ): string {
    const code = currency.trim().toUpperCase() || 'USD';
    const value = amountInCents ? amount / 100 : amount;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
      }).format(value);
    } catch {
      return `$${value.toFixed(2)}`;
    }
  }

  private toIsoFromUnixSeconds(value: number | null | undefined): string | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return null;
    }
    return new Date(value * 1000).toISOString();
  }

  private mapBillingDetails(
    customer: {
      name?: string | null;
      email?: string | null;
      address?: {
        line1?: string | null;
        line2?: string | null;
        city?: string | null;
        state?: string | null;
        postal_code?: string | null;
        country?: string | null;
      } | null;
    },
    fallback: BillingDetails,
  ): BillingDetails {
    const address = customer.address
      ? {
          line1: customer.address.line1?.trim() || null,
          line2: customer.address.line2?.trim() || null,
          city: customer.address.city?.trim() || null,
          state: customer.address.state?.trim() || null,
          postalCode: customer.address.postal_code?.trim() || null,
          country: customer.address.country?.trim() || null,
        }
      : null;

    const hasAddress = Boolean(
      address &&
        (address.line1 ||
          address.city ||
          address.state ||
          address.postalCode ||
          address.country),
    );

    return {
      name: customer.name?.trim() || fallback.name,
      email: customer.email?.trim() || fallback.email,
      address: hasAddress ? address : null,
    };
  }

  private resolvePaymentMethod(
    stripeSubscription: Awaited<
      ReturnType<StripeService['retrievePlatformSubscription']>
    > | null,
    customer: {
      invoice_settings?: {
        default_payment_method?: unknown;
      };
    },
    cards: Array<{
      id: string;
      card?: {
        brand?: string | null;
        last4?: string | null;
        exp_month?: number;
        exp_year?: number;
      } | null;
    }>,
  ): BillingPaymentMethod | null {
    const fromSubscription = this.mapPaymentMethod(
      stripeSubscription?.default_payment_method ?? null,
    );
    if (fromSubscription) return fromSubscription;

    const fromCustomer = this.mapPaymentMethod(
      customer.invoice_settings?.default_payment_method ?? null,
    );
    if (fromCustomer) return fromCustomer;

    return this.mapPaymentMethod(cards[0] ?? null);
  }

  private mapPaymentMethod(value: unknown): BillingPaymentMethod | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as {
      card?: {
        brand?: string | null;
        last4?: string | null;
        exp_month?: number;
        exp_year?: number;
      } | null;
    };
    const last4 = record.card?.last4?.trim() || '';
    if (!last4) return null;
    return {
      brand: record.card?.brand?.trim() || 'card',
      last4,
      expMonth: record.card?.exp_month ?? 0,
      expYear: record.card?.exp_year ?? 0,
    };
  }

  private mapInvoice(invoice: {
    id: string;
    number?: string | null;
    created: number;
    amount_paid?: number;
    amount_due?: number;
    currency: string;
    status?: string | null;
  }): BillingInvoice {
    const amount =
      invoice.status === 'paid'
        ? (invoice.amount_paid ?? invoice.amount_due ?? 0)
        : (invoice.amount_due ?? invoice.amount_paid ?? 0);

    return {
      id: invoice.id,
      number: invoice.number?.trim() || null,
      createdAt: this.toIsoFromUnixSeconds(invoice.created) ?? new Date(0).toISOString(),
      amountFormatted: this.formatMoney(amount, invoice.currency, true),
      currency: invoice.currency,
      status: invoice.status?.trim() || 'unknown',
    };
  }
}
