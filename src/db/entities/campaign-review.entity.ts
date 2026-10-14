import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Automation } from './automation.entity';
import type { Campaign } from './campaign.entity';
import type { Customer } from './customer.entity';

export enum CampaignReviewStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  EXPIRED = 'expired',
}

@Entity('campaign_review')
@Index('IDX_campaign_review_campaign_status_created', [
  'campaignId',
  'status',
  'createdAt',
])
@Index('IDX_campaign_review_token_hash', ['tokenHash'], { unique: true })
export class CampaignReview {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'token_hash', type: 'varchar', length: 64, unique: true })
  tokenHash!: string;

  @Column({ name: 'business_id', type: 'int' })
  businessId!: number;

  @Column({ name: 'campaign_id', type: 'int' })
  campaignId!: number;

  @ManyToOne(() => require('./campaign.entity').Campaign, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'campaign_id' })
  campaign!: Campaign;

  @Column({ name: 'funnel_id', type: 'int', nullable: true })
  funnelId!: number | null;

  @Column({ name: 'customer_id', type: 'int' })
  customerId!: number;

  @ManyToOne(() => require('./customer.entity').Customer, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ name: 'automation_id', type: 'int', nullable: true })
  automationId!: number | null;

  @ManyToOne(() => require('./automation.entity').Automation, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'automation_id' })
  automation!: Automation | null;

  @Column({ name: 'execution_id', type: 'int', nullable: true })
  executionId!: number | null;

  @Column({ name: 'node_id', type: 'int', nullable: true })
  nodeId!: number | null;

  @Column({
    type: 'varchar',
    length: 32,
    default: CampaignReviewStatus.PENDING,
  })
  status!: CampaignReviewStatus;

  @Column({ type: 'smallint', nullable: true })
  rating!: number | null;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @Column({ name: 'guest_name', type: 'varchar', length: 255, nullable: true })
  guestName!: string | null;

  @Column({ name: 'guest_email', type: 'varchar', length: 255, nullable: true })
  guestEmail!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
