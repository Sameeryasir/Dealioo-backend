import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Funnel } from './funnel.entity';
import { Business } from './business.entity';
import { Order } from './order.entity';
import { Customer } from './customer.entity';

export enum FunnelPaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
  DISPUTED = 'disputed',
}

export enum FunnelPaymentSource {
  STRIPE = 'STRIPE',
  SCANNER = 'SCANNER',
  MANUAL = 'MANUAL',
}

export enum FunnelCollectionChannel {
  ONLINE = 'ONLINE',
  IN_STORE = 'IN_STORE',
}

export enum FunnelPaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  ONLINE_CARD = 'ONLINE_CARD',
  OTHER = 'OTHER',
}

@Entity('funnel_payment')
export class FunnelPayment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'funnel_id', type: 'int', nullable: true })
  funnelId!: number;

  @ManyToOne(() => Funnel, (funnel) => funnel.payments, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'funnel_id' })
  funnel!: Funnel;

  @Column({ name: 'restaurant_id' })
  businessId!: number;

  @ManyToOne(() => Business, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'restaurant_id' })
  business!: Business;

  @Column({ name: 'campaign_id', type: 'int', nullable: true })
  campaignId!: number | null;

  @Column({ name: 'customer_id', type: 'int', nullable: true })
  customerId!: number | null;

  @ManyToOne(() => Customer, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer | null;

  @Column({ name: 'order_id', type: 'int', nullable: true })
  orderId!: number | null;

  @ManyToOne(() => Order, (order) => order.payments, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'order_id' })
  order!: Order | null;

  @Column({
    name: 'stripe_payment_intent_id',
    type: 'varchar',
    length: 255,
    unique: true,
    nullable: true,
  })
  stripePaymentIntentId!: string | null;

  @Column({
    name: 'stripe_checkout_session_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeCheckoutSessionId!: string | null;

  @Column({ name: 'platform_fee_amount', type: 'int', default: 0 })
  platformFeeAmount!: number;

  @Column({ name: 'refunded_amount', type: 'int', default: 0 })
  refundedAmount!: number;

  @Column({
    name: 'stripe_charge_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeChargeId!: string | null;

  @Column({
    name: 'stripe_dispute_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeDisputeId!: string | null;

  @Column({
    name: 'dispute_status',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  disputeStatus!: string | null;

  @Column({
    name: 'stripe_connected_account_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeConnectedAccountId!: string | null;

  @Column({ type: 'int' })
  amount!: number;

  @Column({ type: 'varchar', length: 10 })
  currency!: string;

  @Column({
    type: 'varchar',
    length: 32,
    enum: FunnelPaymentStatus,
    default: FunnelPaymentStatus.PENDING,
  })
  status!: FunnelPaymentStatus;

  @Column({ name: 'customer_email', type: 'varchar', length: 320 })
  customerEmail!: string;

  @Column({
    name: 'payment_method',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  paymentMethod!: string | null;

  @Column({
    name: 'payment_source',
    type: 'varchar',
    length: 32,
    enum: FunnelPaymentSource,
    nullable: true,
  })
  paymentSource!: FunnelPaymentSource | null;

  @Column({
    name: 'collection_channel',
    type: 'varchar',
    length: 32,
    enum: FunnelCollectionChannel,
    nullable: true,
  })
  collectionChannel!: FunnelCollectionChannel | null;

  @Column({ name: 'payment_collected_by', type: 'int', nullable: true })
  paymentCollectedBy!: number | null;

  @Column({ name: 'payment_collected_at', type: 'timestamptz', nullable: true })
  paymentCollectedAt!: Date | null;

  @Column({ name: 'receipt_url', type: 'text', nullable: true })
  receiptUrl!: string | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({
    name: 'stripe_refund_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeRefundId!: string | null;

  @Column({ name: 'refunded_at', type: 'timestamptz', nullable: true })
  refundedAt!: Date | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
