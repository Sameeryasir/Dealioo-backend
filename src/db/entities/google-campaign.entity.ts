import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('google_campaigns')
export class GoogleCampaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'int', nullable: true })
  userId: number | null;

  @Column({ name: 'business_id', type: 'int' })
  businessId: number;

  @Column({ name: 'draft_id', type: 'uuid', nullable: true })
  draftId: string | null;

  @Column({ name: 'customer_id', type: 'varchar', length: 64 })
  customerId: string;

  @Column({
    name: 'google_campaign_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  googleCampaignId: string | null;

  @Column({
    name: 'google_budget_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  googleBudgetId: string | null;

  @Column({
    name: 'google_ad_group_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  googleAdGroupId: string | null;

  @Column({
    name: 'google_ad_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  googleAdId: string | null;

  @Column({ name: 'google_keyword_ids', type: 'jsonb', nullable: true })
  googleKeywordIds: string[] | null;

  @Column({ name: 'campaign_name', type: 'varchar', length: 255, nullable: true })
  campaignName: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  goal: string | null;

  @Column({ name: 'campaign_type', type: 'varchar', length: 64, nullable: true })
  campaignType: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  budget: string | null;

  @Column({ type: 'varchar', length: 32, default: 'PENDING' })
  status: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
