import {
  BadRequestException,
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
import type { UpgradeSubscriptionDto } from './dto/upgrade-subscription.dto';
import type { UpgradeSubscriptionResponse } from './billing.types';

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserSubscription)
    private readonly subscriptionRepository: Repository<UserSubscription>,
    @InjectRepository(SubscriptionPlan)
    private readonly planRepository: Repository<SubscriptionPlan>,
    private readonly stripeService: StripeService,
  ) {}

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
    await this.subscriptionRepository.update(localSub.id, {
      planId: targetPlan.id,
      billingCycle,
      ...(mappedStatus ? { status: mappedStatus } : {}),
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
}
