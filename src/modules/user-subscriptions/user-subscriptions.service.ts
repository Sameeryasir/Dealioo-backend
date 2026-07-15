import {
  BadRequestException,
  ConflictException,
  Injectable,
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
import { SelectUserPlanDto } from './user-subscriptions.dto';

export type UserSubscriptionResponse = {
  id: string;
  planId: string;
  planSlug: string;
  planName: string;
  billingCycle: UserSubscriptionBillingCycle;
  status: string;
  startedAt: string | null;
};

export type UserSubscriptionCheckoutResponse = {
  checkoutUrl: string;
  sessionId: string;
};

type StripeCheckoutSession = {
  id: string;
  status?: string | null;
  mode?: string | null;
  customer?: string | { id?: string } | null;
  subscription?: string | { id?: string } | null;
  metadata?: Record<string, string> | null;
};

type StripeSubscription = {
  id: string;
  status?: string | null;
  metadata?: Record<string, string> | null;
};

const PLATFORM_SUBSCRIPTION = 'platform_subscription';

@Injectable()
export class UserSubscriptionsService {
  constructor(
    @InjectRepository(UserSubscription)
    private readonly subscriptionRepository: Repository<UserSubscription>,
    @InjectRepository(SubscriptionPlan)
    private readonly planRepository: Repository<SubscriptionPlan>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly stripeService: StripeService,
  ) {}

  getActiveSubscriptionForUser(
    userId: number,
  ): Promise<UserSubscriptionResponse | null> {
    return this.getPlanSummaryForUser(userId);
  }

  getPlanSummaryForUser(
    userId: number,
  ): Promise<UserSubscriptionResponse | null> {
    return this.subscriptionRepository
      .createQueryBuilder('sub')
      .innerJoinAndSelect('sub.plan', 'plan')
      .select([
        'sub.id',
        'sub.planId',
        'sub.billingCycle',
        'sub.status',
        'sub.startedAt',
        'plan.id',
        'plan.slug',
        'plan.name',
      ])
      .where('sub.user_id = :userId', { userId })
      .andWhere('sub.status IN (:...statuses)', {
        statuses: ['active', 'trialing'],
      })
      .orderBy('sub.created_at', 'DESC')
      .limit(1)
      .getOne()
      .then((row) => {
        if (!row?.plan) return null;
        return {
          id: row.id,
          planId: row.planId,
          planSlug: row.plan.slug,
          planName: row.plan.name,
          billingCycle: row.billingCycle,
          status: row.status,
          startedAt: row.startedAt?.toISOString() ?? null,
        };
      });
  }

  userHasActiveSubscription(userId: number): Promise<boolean> {
    return this.subscriptionRepository
      .count({ where: { userId, status: In(['active', 'trialing']) } })
      .then((count) => count > 0);
  }

  async createCheckoutForUser(
    userId: number,
    dto: SelectUserPlanDto,
  ): Promise<UserSubscriptionCheckoutResponse> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, email: true, name: true, stripeCustomerId: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (await this.userHasActiveSubscription(userId)) {
      throw new ConflictException('You already have an active subscription.');
    }

    const plan = await this.planRepository.findOne({
      where: { slug: dto.planSlug.trim().toLowerCase(), isActive: true },
    });

    if (!plan) {
      throw new NotFoundException('Subscription plan not found.');
    }

    const priceId = this.resolveStripePriceId(plan, dto.billingCycle);
    if (!priceId) {
      throw new BadRequestException(
        dto.billingCycle === 'annual'
          ? 'Annual billing is not available for this plan yet. Choose monthly or contact sales.'
          : 'This plan is not available for online checkout. Please contact sales.',
      );
    }

    const checkout = await this.stripeService.createPlatformSubscriptionCheckoutSession(
      {
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        stripeCustomerId: user.stripeCustomerId,
        priceId,
        planSlug: plan.slug,
        billingCycle: dto.billingCycle,
      },
    );

    if (
      checkout.stripeCustomerId &&
      checkout.stripeCustomerId !== user.stripeCustomerId
    ) {
      await this.userRepository.update(user.id, {
        stripeCustomerId: checkout.stripeCustomerId,
      });
    }

    return { checkoutUrl: checkout.url, sessionId: checkout.sessionId };
  }

  async completeCheckout(
    userId: number,
    sessionId: string,
  ): Promise<UserSubscriptionResponse> {
    const session = await this.loadCompletedCheckoutSession(userId, sessionId);
    const subscription = await this.activateFromCheckoutSession(session);
    return this.toResponse(subscription);
  }

  /** Primary activation path: Stripe webhook `checkout.session.completed`. */
  async handleStripeWebhookEvent(event: {
    type: string;
    data: { object: unknown };
  }): Promise<void> {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as StripeCheckoutSession;
      if (
        session.mode === 'subscription' &&
        session.metadata?.purpose === PLATFORM_SUBSCRIPTION &&
        session.status === 'complete'
      ) {
        const resolved = await this.resolveCheckoutSession(session);
        await this.activateFromCheckoutSession(resolved);
      }
      return;
    }

    if (
      event.type === 'customer.subscription.deleted' &&
      (event.data.object as StripeSubscription).metadata?.purpose ===
        PLATFORM_SUBSCRIPTION
    ) {
      await this.markSubscriptionCancelled(
        (event.data.object as StripeSubscription).id,
      );
    }
  }

  private async loadCompletedCheckoutSession(
    userId: number,
    sessionId: string,
  ): Promise<StripeCheckoutSession> {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      throw new BadRequestException('Missing Stripe checkout session id.');
    }

    const session = await this.stripeService.retrievePlatformCheckoutSession(
      trimmed,
    );

    this.assertSessionBelongsToUser(session, userId);

    if (session.status !== 'complete') {
      throw new BadRequestException('Stripe checkout is not complete yet.');
    }

    return session;
  }

  private async resolveCheckoutSession(
    session: StripeCheckoutSession,
  ): Promise<StripeCheckoutSession> {
    if (this.extractStripeId(session.subscription)) {
      return session;
    }

    return this.stripeService.retrievePlatformCheckoutSession(session.id);
  }

  private async activateFromCheckoutSession(
    session: StripeCheckoutSession,
  ): Promise<UserSubscription> {
    const userId = this.parseUserId(session.metadata?.userId);
    const planSlug = session.metadata?.planSlug?.trim().toLowerCase();
    const billingCycle = this.parseBillingCycle(session.metadata?.billingCycle);
    const stripeSubscriptionId = this.extractStripeId(session.subscription);
    const stripeCustomerId = this.extractStripeId(session.customer);

    if (!userId || !planSlug || !billingCycle || !stripeSubscriptionId) {
      throw new BadRequestException('Invalid Stripe checkout session.');
    }

    const existing = await this.subscriptionRepository.findOne({
      where: { stripeSubscriptionId },
      relations: { plan: true },
    });

    if (existing?.plan) {
      return existing;
    }

    const activeForUser = await this.subscriptionRepository.findOne({
      where: { userId, status: 'active' },
      relations: { plan: true },
    });

    if (activeForUser?.plan) {
      return activeForUser;
    }

    const plan = await this.planRepository.findOne({
      where: { slug: planSlug, isActive: true },
    });

    if (!plan) {
      throw new NotFoundException('Subscription plan not found.');
    }

    const saved = await this.subscriptionRepository.save(
      this.subscriptionRepository.create({
        userId,
        planId: plan.id,
        billingCycle,
        status: 'active',
        startedAt: new Date(),
        stripeCustomerId,
        stripeSubscriptionId,
      }),
    );

    saved.plan = plan;

    if (stripeCustomerId) {
      await this.userRepository.update(userId, { stripeCustomerId });
    }

    return saved;
  }

  private async markSubscriptionCancelled(
    stripeSubscriptionId: string,
  ): Promise<void> {
    const record = await this.subscriptionRepository.findOne({
      where: { stripeSubscriptionId },
    });

    if (!record) {
      return;
    }

    await this.subscriptionRepository.update(record.id, {
      status: 'cancelled',
      cancelledAt: new Date(),
    });
  }

  private assertSessionBelongsToUser(
    session: StripeCheckoutSession,
    userId: number,
  ): void {
    if (session.metadata?.purpose !== PLATFORM_SUBSCRIPTION) {
      throw new BadRequestException('This checkout session is not for a plan.');
    }

    if (this.parseUserId(session.metadata?.userId) !== userId) {
      throw new BadRequestException(
        'This checkout session does not belong to your account.',
      );
    }
  }

  private resolveStripePriceId(
    plan: SubscriptionPlan,
    billingCycle: UserSubscriptionBillingCycle,
  ): string | null {
    return billingCycle === 'annual'
      ? plan.stripeYearlyPriceId?.trim() || null
      : plan.stripeMonthlyPriceId?.trim() || null;
  }

  private parseUserId(value: string | undefined): number | null {
    if (!value?.trim()) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private parseBillingCycle(
    value: string | undefined,
  ): UserSubscriptionBillingCycle | null {
    return value === 'monthly' || value === 'annual' ? value : null;
  }

  private extractStripeId(
    value: string | { id?: string } | null | undefined,
  ): string | null {
    if (!value) return null;
    if (typeof value === 'string') return value.trim() || null;
    return value.id?.trim() || null;
  }

  private toResponse(subscription: UserSubscription): UserSubscriptionResponse {
    return {
      id: subscription.id,
      planId: subscription.planId,
      planSlug: subscription.plan.slug,
      planName: subscription.plan.name,
      billingCycle: subscription.billingCycle,
      status: subscription.status,
      startedAt: subscription.startedAt?.toISOString() ?? null,
    };
  }
}
