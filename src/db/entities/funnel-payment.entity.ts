/**
 * Funnel checkout payment row: links funnel + restaurant to Stripe PI and payout account.
 * Status values: pending | paid | failed | cancelled | refunded (see FunnelPaymentStatus).
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Funnel } from './funnel.entity';
import { Restaurant } from './restaurant.entity';

// --- Payment lifecycle (stored as varchar in DB) ---
export enum FunnelPaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

@Entity('funnel_payment')
export class FunnelPayment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'funnel_id' })
  funnelId: number;

  @ManyToOne(() => Funnel, (funnel) => funnel.payments, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'funnel_id' })
  funnel: Funnel;

  @Column({ name: 'restaurant_id' })
  restaurantId: number;

  @ManyToOne(() => Restaurant, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'restaurant_id' })
  restaurant: Restaurant;

  @Column({
    name: 'stripe_payment_intent_id',
    type: 'varchar',
    length: 255,
    unique: true,
  })
  stripePaymentIntentId: string;

  @Column({
    name: 'stripe_connected_account_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeConnectedAccountId: string | null;

  @Column({ type: 'int' })
  amount: number;

  @Column({ type: 'varchar', length: 10 })
  currency: string;

  @Column({
    type: 'varchar',
    length: 32,
    default: FunnelPaymentStatus.PENDING,
  })
  status: FunnelPaymentStatus;

  @Column({ name: 'customer_email', type: 'varchar', length: 320 })
  customerEmail: string;

  @Column({
    name: 'payment_method',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  paymentMethod: string | null;

  @Column({ name: 'receipt_url', type: 'text', nullable: true })
  receiptUrl: string | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({
    name: 'stripe_refund_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeRefundId: string | null;

  @Column({ name: 'refunded_at', type: 'timestamptz', nullable: true })
  refundedAt: Date | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
