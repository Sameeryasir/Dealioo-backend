import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Business } from './business.entity';
import { User } from './user.entity';

export enum BusinessHistoryEventType {
  CAMPAIGN_CREATED = 'campaign_created',
  CAMPAIGN_UPDATED = 'campaign_updated',
  CAMPAIGN_DELETED = 'campaign_deleted',
  BUSINESS_CREATED = 'business_created',
  BUSINESS_UPDATED = 'business_updated',
  BUSINESS_DELETED = 'business_deleted',
  AUTOMATION_UPDATED = 'automation_updated',
  AUTOMATION_ACTIVATED = 'automation_activated',
  AUTOMATION_DEACTIVATED = 'automation_deactivated',
  AUTOMATION_DELETED = 'automation_deleted',
  FUNNEL_UPDATED = 'funnel_updated',
  FUNNEL_DELETED = 'funnel_deleted',
  SCANNER_REDEEMED = 'scanner_redeemed',
  SCANNER_PAYMENT = 'scanner_payment',
  SCANNER_PURCHASE = 'scanner_purchase',
}

@Entity('business_history')
@Index('IDX_business_history_business_occurred', ['businessId', 'occurredAt'])
@Index('IDX_business_history_idempotency', ['idempotencyKey'], { unique: true })
export class BusinessHistory {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'business_id', type: 'int', nullable: true })
  businessId!: number | null;

  @ManyToOne(() => Business, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'business_id' })
  business!: Business | null;

  @Column({ name: 'event_type', type: 'varchar', length: 40 })
  eventType!: BusinessHistoryEventType;

  @Column({ type: 'text' })
  description!: string;

  @Column({ name: 'actor_user_id', type: 'int', nullable: true })
  actorUserId!: number | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser!: User | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
