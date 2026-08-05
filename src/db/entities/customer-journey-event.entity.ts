import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Campaign } from './campaign.entity';
import type { Customer } from './customer.entity';
import type { Funnel } from './funnel.entity';
import type { Business } from './business.entity';
export enum CustomerJourneyStep {
  SIGNUP = 'signup',
  PAYMENT = 'payment',
  QR_REDEEMED = 'qr_redeemed',
}

@Entity('customer_journey_events')
@Index('IDX_customer_journey_lookup', [
  'businessId',
  'customerId',
  'campaignId',
  'step',
])
@Index('IDX_customer_journey_idempotency', ['idempotencyKey'], { unique: true })
export class CustomerJourneyEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'business_id' })
  businessId: number;

  @ManyToOne(() => require('./business.entity').Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business: Business;

  @Column({ name: 'customer_id' })
  customerId: number;

  @ManyToOne(() => require('./customer.entity').Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'campaign_id' })
  campaignId: number;

  @ManyToOne(() => require('./campaign.entity').Campaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @Column({ name: 'funnel_id', type: 'int', nullable: true })
  funnelId: number | null;

  @ManyToOne(() => require('./funnel.entity').Funnel, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'funnel_id' })
  funnel: Funnel | null;

  @Column({ type: 'varchar', length: 32 })
  step: CustomerJourneyStep;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  @Column({ name: 'source', type: 'varchar', length: 64 })
  source: string;

  @Column({ name: 'ref_type', type: 'varchar', length: 64, nullable: true })
  refType: string | null;

  @Column({ name: 'ref_id', type: 'varchar', length: 64, nullable: true })
  refId: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 160 })
  idempotencyKey: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
