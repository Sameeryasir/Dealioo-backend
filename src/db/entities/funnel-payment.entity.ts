import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Customer } from './customer.entity';
import { Funnel } from './funnel.entity';

export enum FunnelPaymentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  CANCELLED = 'cancelled',
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

  @Column({ name: 'customer_id', nullable: true })
  customerId: number | null;

  @ManyToOne(() => Customer, (customer) => customer.funnelPayments, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer | null;

  @Column({
    name: 'stripe_payment_intent_id',
    type: 'varchar',
    length: 255,
    unique: true,
  })
  stripePaymentIntentId: string;

  @Column({
    name: 'stripe_customer_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeCustomerId: string | null;

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

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'refunded_at', type: 'timestamptz', nullable: true })
  refundedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
