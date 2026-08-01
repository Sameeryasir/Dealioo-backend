import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  GoogleCampaignBuilderDraftData,
  GoogleCampaignGoalId,
  GoogleCampaignTypeId,
} from './google-campaign-builder-draft.types';

@Entity('google_campaign_drafts')
export class GoogleCampaignDraft {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({ name: 'business_id', type: 'int' })
  businessId: number;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy: number | null;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  updatedBy: number | null;

  @Column({ name: 'current_step', type: 'int', default: 1 })
  currentStep: number;

  @Column({ type: 'varchar', length: 32, default: 'DRAFT' })
  status: string;

  @Column({ name: 'draft_data', type: 'jsonb', nullable: true })
  draftData: GoogleCampaignBuilderDraftData | null;

  @Column({ name: 'campaign_name', type: 'varchar', length: 255, nullable: true })
  campaignName: string | null;

  @Column({ name: 'goal', type: 'varchar', length: 32, nullable: true })
  goal: GoogleCampaignGoalId | null;

  @Column({ name: 'campaign_type', type: 'varchar', length: 32, nullable: true })
  campaignType: GoogleCampaignTypeId | null;

  @Column({ name: 'business_name', type: 'varchar', length: 255, nullable: true })
  businessName: string | null;

  @Column({
    name: 'daily_budget',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  dailyBudget: string | null;

  @Column({
    name: 'google_campaign_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  googleCampaignId: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'version', type: 'int', default: 1 })
  version: number;

  @Column({
    name: 'completed_steps',
    type: 'int',
    array: true,
    default: '{}',
  })
  completedSteps: number[];

  @Column({ name: 'last_saved_at', type: 'timestamptz', nullable: true })
  lastSavedAt: Date | null;

  @Column({ name: 'publish_status', type: 'varchar', length: 32, nullable: true })
  publishStatus: string | null;

  @Column({ name: 'publish_job_id', type: 'varchar', length: 128, nullable: true })
  publishJobId: string | null;

  @Column({ name: 'publish_step', type: 'varchar', length: 64, nullable: true })
  publishStep: string | null;

  @Column({ name: 'publish_progress', type: 'int', default: 0 })
  publishProgress: number;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({
    name: 'last_idempotency_key',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  lastIdempotencyKey: string | null;

  @Column({ name: 'last_idempotency_response', type: 'jsonb', nullable: true })
  lastIdempotencyResponse: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
