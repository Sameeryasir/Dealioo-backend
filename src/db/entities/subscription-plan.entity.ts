import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserSubscription } from './user-subscription.entity';

export type SubscriptionPlanFeatureGroup = {
  label: string;
  items: string[];
};

export type SubscriptionPlanPricingTier = {
  price: string;
  period: string;
  /** Struck-through list price shown next to the discounted `price`. */
  originalPrice?: string | null;
  promo: string | null;
  subline: string | null;
};

export type SubscriptionPlanDescription = {
  badge: string | null;
  tagline: string;
  summary: string;
  features?: string[];
  featureGroups?: SubscriptionPlanFeatureGroup[];
  cta: string;
  highlighted: boolean;
  salesEmail?: string | null;
  color?: string;
  monthly: SubscriptionPlanPricingTier;
  annual: SubscriptionPlanPricingTier;
};

@Entity('subscription_plans')
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  slug: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'jsonb', nullable: true })
  description: SubscriptionPlanDescription | null;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  monthlyPrice: number | null;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  yearlyPrice: number | null;

  @Column({ type: 'varchar', nullable: true })
  stripeMonthlyPriceId: string | null;

  @Column({ type: 'varchar', nullable: true })
  stripeYearlyPriceId: string | null;

  @Column({ type: 'varchar', default: 'USD' })
  currency: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => UserSubscription, (subscription) => subscription.plan)
  userSubscriptions: UserSubscription[];
}
