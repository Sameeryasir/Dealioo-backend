import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { SubscriptionPlan } from './subscription-plan.entity';

export type UserSubscriptionBillingCycle = 'monthly' | 'annual';
export type UserSubscriptionStatus =
  | 'active'
  | 'cancelled'
  | 'past_due'
  | 'trialing';

@Entity('user_subscriptions')
export class UserSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.subscriptions, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @ManyToOne(() => SubscriptionPlan, (plan) => plan.userSubscriptions, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'plan_id' })
  plan: SubscriptionPlan;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @Column({ name: 'billing_cycle', type: 'varchar', length: 16 })
  billingCycle: UserSubscriptionBillingCycle;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status: UserSubscriptionStatus;

  @Column({ name: 'stripe_customer_id', type: 'varchar', nullable: true })
  stripeCustomerId: string | null;

  @Column({ name: 'stripe_subscription_id', type: 'varchar', nullable: true })
  stripeSubscriptionId: string | null;

  @Column({ name: 'cancel_at_period_end', type: 'boolean', default: false })
  cancelAtPeriodEnd: boolean;

  @Column({ name: 'cancel_requested_at', type: 'timestamptz', nullable: true })
  cancelRequestedAt: Date | null;

  @Column({ name: 'cancellation_reason', type: 'varchar', length: 255, nullable: true })
  cancellationReason: string | null;

  @Column({ name: 'cancellation_comment', type: 'text', nullable: true })
  cancellationComment: string | null;

  @Column({ name: 'cancels_at', type: 'timestamptz', nullable: true })
  cancelsAt: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
