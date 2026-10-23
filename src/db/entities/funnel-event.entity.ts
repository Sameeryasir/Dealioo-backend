import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Customer } from './customer.entity';
import type { Funnel } from './funnel.entity';
import type {
  FunnelPayment,
  FunnelPaymentStatus,
} from './funnel-payment.entity';
export enum FunnelEventType {
  SIGNUP = 'signup',
  PAYMENT = 'payment',
}

export type FunnelEventAdSource = 'meta' | 'google' | 'utm';

@Entity('funnel_event')
@Index(
  'IDX_funnel_event_funnel_customer_created',
  ['funnelId', 'customerId', 'createdAt'],
  {
    where: '"deleted_at" IS NULL AND "customer_id" IS NOT NULL',
  },
)
@Index('IDX_funnel_event_funnel_created', ['funnelId', 'createdAt'])
@Index('IDX_funnel_event_funnel_type_created', [
  'funnelId',
  'eventType',
  'createdAt',
])
@Index('IDX_funnel_event_funnel_type_ad_source_created', [
  'funnelId',
  'eventType',
  'adSource',
  'createdAt',
])
@Index('IDX_funnel_event_funnel_type_payment_status_created', [
  'funnelId',
  'eventType',
  'paymentStatus',
  'createdAt',
])
export class FunnelEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'funnel_id', type: 'int', nullable: true })
  funnelId!: number;

  @ManyToOne(() => require('./funnel.entity').Funnel, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'funnel_id' })
  funnel!: Funnel;

  @Column({
    name: 'event_type',
    type: 'enum',
    enum: FunnelEventType,
  })
  eventType: FunnelEventType;

  @Column({ name: 'customer_id', nullable: true })
  customerId: number | null;

  @ManyToOne(() => require('./customer.entity').Customer, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer | null;

  @Column({ name: 'visitor_id', type: 'varchar', length: 64, nullable: true })
  visitorId: string | null;

  @Column({ name: 'funnel_payment_id', nullable: true })
  funnelPaymentId: number | null;

  @ManyToOne(() => require('./funnel-payment.entity').FunnelPayment, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'funnel_payment_id' })
  funnelPayment: FunnelPayment | null;

  @Column({ type: 'int', nullable: true })
  amount: number | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  currency: string | null;

  @Column({
    name: 'payment_status',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  paymentStatus: FunnelPaymentStatus | null;

  @Column({
    name: 'stripe_payment_intent_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripePaymentIntentId: string | null;

  @Column({
    name: 'customer_email',
    type: 'varchar',
    length: 320,
    nullable: true,
  })
  customerEmail: string | null;

  @Column({ name: 'receipt_url', type: 'text', nullable: true })
  receiptUrl: string | null;

  @Column({ name: 'ad_source', type: 'varchar', length: 16, nullable: true })
  adSource: FunnelEventAdSource | null;

  @Column({
    name: 'ad_source_label',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  adSourceLabel: string | null;

  @Column({
    name: 'ad_source_detail',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  adSourceDetail: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
