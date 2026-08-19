/**
 * Guest-facing activity feed — visits, redemptions, prepaid offers, messages.
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
import type { Customer } from './customer.entity';
import type { Business } from './business.entity';
export enum ActivityEventType {
  VISITED = 'visited',
  REDEEMED_REWARD = 'redeemed_reward',
  PREPAID_FOR_OFFER = 'prepaid_for_offer',
  MESSAGE_SENT = 'message_sent',
  SIGNED_UP = 'signed_up',
}

@Entity('activity_event')
@Index('IDX_activity_event_restaurant_occurred', ['businessId', 'occurredAt'])
@Index('IDX_activity_event_idempotency', ['idempotencyKey'], { unique: true })
export class ActivityEvent {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'business_id' })
  businessId!: number;

  @ManyToOne(() => require('./business.entity').Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business!: Business;

  @Column({ name: 'customer_id', type: 'int', nullable: true })
  customerId!: number | null;

  @ManyToOne(() => require('./customer.entity').Customer, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer | null;

  @Column({ name: 'event_type', type: 'varchar', length: 32 })
  eventType!: ActivityEventType;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
