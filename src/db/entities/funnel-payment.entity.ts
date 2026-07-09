/**
 * Funnel checkout payment row: links funnel + business to Stripe PI and payout account.
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
import { Business } from './business.entity';

// --- Payment lifecycle (stored as varchar in DB) ---
export enum FunnelPaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
  DISPUTED = 'disputed',
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
  businessId: number;

  @ManyToOne(() => Business, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'restaurant_id' })
  business: Business;

  @Column({ name: 'campaign_id', type: 'int', nullable: true })
  campaignId: number | null;

  @Column({
    name: 'stripe_payment_intent_id',
    type: 'varchar',
    length: 255,
    unique: true,
    nullable: true,
  })
  stripePaymentIntentId: string | null;

  @Column({ name: 'platform_fee_amount', type: 'int', default: 0 })
  platformFeeAmount: number;

  @Column({ name: 'refunded_amount', type: 'int', default: 0 })
  refundedAmount: number;

  @Column({
    name: 'stripe_charge_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeChargeId: string | null;

  @Column({
    name: 'stripe_dispute_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeDisputeId: string | null;

  @Column({
    name: 'dispute_status',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  disputeStatus: string | null;

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
