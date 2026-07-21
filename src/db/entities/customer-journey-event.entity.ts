import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';
import { Customer } from './customer.entity';
import { Funnel } from './funnel.entity';
import { Business } from './business.entity';

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

  @Column({ name: 'restaurant_id' })
  businessId: number;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id' })
  business: Business;

  @Column({ name: 'customer_id' })
  customerId: number;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'campaign_id' })
  campaignId: number;

  @ManyToOne(() => Campaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @Column({ name: 'funnel_id', type: 'int', nullable: true })
  funnelId: number | null;

  @ManyToOne(() => Funnel, { onDelete: 'SET NULL', nullable: true })
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
