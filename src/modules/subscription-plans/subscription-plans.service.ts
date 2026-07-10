import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SubscriptionPlan,
  type SubscriptionPlanDescription,
} from '../../db/entities/subscription-plan.entity';

export type SubscriptionPlanListItem = {
  id: string;
  slug: string;
  name: string;
  monthlyPrice: number | null;
  yearlyPrice: number | null;
  description: SubscriptionPlanDescription | null;
};

@Injectable()
export class SubscriptionPlansService {
  constructor(
    @InjectRepository(SubscriptionPlan)
    private readonly planRepository: Repository<SubscriptionPlan>,
  ) {}

  async listPlans(): Promise<SubscriptionPlanListItem[]> {
    const plans = await this.planRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    return plans.map((plan) => this.toListItem(plan));
  }

  private toListItem(plan: SubscriptionPlan): SubscriptionPlanListItem {
    return {
      id: plan.id,
      slug: plan.slug,
      name: plan.name,
      monthlyPrice: this.parseDecimal(plan.monthlyPrice),
      yearlyPrice: this.parseDecimal(plan.yearlyPrice),
      description: this.normalizeDescription(plan.description),
    };
  }

  private parseDecimal(value: unknown): number | null {
    if (value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalizeDescription(
    value: SubscriptionPlanDescription | string | null,
  ): SubscriptionPlanDescription | null {
    if (value == null) return null;
    if (typeof value === 'string') {
      return {
        badge: null,
        tagline: '',
        summary: value.trim(),
        cta: 'Continue',
        highlighted: false,
        monthly: {
          price: 'Custom',
          period: '',
          promo: null,
          subline: null,
        },
        annual: {
          price: 'Custom',
          period: '',
          promo: null,
          subline: null,
        },
      };
    }

    return value;
  }
}
