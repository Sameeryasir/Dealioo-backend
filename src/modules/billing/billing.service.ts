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
    const newPriceId = dto.priceId.trim();

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

    const targetPlan = await this.findPlanByStripePriceId(newPriceId);
    if (!targetPlan) {
      throw new BadRequestException(
        'This Stripe price is not linked to an active Dealioo plan.',
      );
    }

    await this.stripeService.retrievePlatformPrice(newPriceId);

    const billingCycle = this.resolveBillingCycleForPrice(
      targetPlan,
      newPriceId,
    );

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

  private resolveBillingCycleForPrice(
    plan: SubscriptionPlan,
    priceId: string,
  ): UserSubscriptionBillingCycle {
    if (plan.stripeYearlyPriceId?.trim() === priceId) {
      return 'annual';
    }
    return 'monthly';
  }
}
