import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('meta_campaign_drafts')
export class MetaCampaignDraft {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({ name: 'business_id', type: 'int' })
  businessId: number;

  @Column({ name: 'current_step', type: 'int', default: 1 })
  currentStep: number;

  @Column({ type: 'varchar', length: 32, default: 'draft' })
  status: string;

  @Column({ name: 'campaign_data', type: 'jsonb', nullable: true })
  campaignData: Record<string, unknown> | null;

  @Column({ name: 'adset_data', type: 'jsonb', nullable: true })
  adSetData: Record<string, unknown> | null;

  @Column({ name: 'ad_creative_data', type: 'jsonb', nullable: true })
  adCreativeData: Record<string, unknown> | null;

  @Column({ name: 'meta_campaign_id', type: 'varchar', length: 64, nullable: true })
  metaCampaignId: string | null;

  @Column({ name: 'meta_adset_id', type: 'varchar', length: 64, nullable: true })
  metaAdsetId: string | null;

  @Column({ name: 'meta_creative_id', type: 'varchar', length: 64, nullable: true })
  metaCreativeId: string | null;

  @Column({ name: 'meta_ad_id', type: 'varchar', length: 64, nullable: true })
  metaAdId: string | null;

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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
