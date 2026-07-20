/**
 * Unified business activity feed — visited, redeemed, prepaid funnel payments.
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Customer } from './customer.entity';
import { Business } from './business.entity';

export enum ActivityEventType {
  VISITED = 'visited',
  REDEEMED_REWARD = 'redeemed_reward',
  PREPAID_FOR_OFFER = 'prepaid_for_offer',
  MESSAGE_SENT = 'message_sent',
  CAMPAIGN_CREATED = 'campaign_created',
  CAMPAIGN_UPDATED = 'campaign_updated',
  CAMPAIGN_DELETED = 'campaign_deleted',
}

@Entity('activity_event')
@Index('IDX_activity_event_restaurant_occurred', ['businessId', 'occurredAt'])
@Index('IDX_activity_event_idempotency', ['idempotencyKey'], { unique: true })
export class ActivityEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'restaurant_id' })
  businessId: number;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id' })
  business: Business;

  @Column({ name: 'customer_id', type: 'int', nullable: true })
  customerId: number | null;

  @ManyToOne(() => Customer, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer | null;

  @Column({ name: 'event_type', type: 'varchar', length: 32 })
  eventType: ActivityEventType;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  /** Prevents duplicate rows when webhooks and frontend both confirm payment. */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
