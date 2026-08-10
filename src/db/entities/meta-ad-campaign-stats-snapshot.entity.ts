import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('meta_ad_campaign_stats_snapshots')
@Index(
  'UQ_meta_ad_campaign_stats_snapshots_biz_account_preset',
  ['businessId', 'adAccountId', 'datePreset'],
  { unique: true },
)
@Index('IDX_meta_ad_campaign_stats_snapshots_business', ['businessId'])
export class MetaAdCampaignStatsSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'business_id', type: 'int' })
  businessId!: number;

  @Column({ name: 'ad_account_id', type: 'varchar', length: 64 })
  adAccountId!: string;

  @Column({ name: 'date_preset', type: 'varchar', length: 32 })
  datePreset!: string;

  @Column({ name: 'include_insights', type: 'boolean', default: true })
  includeInsights!: boolean;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'fetched_at', type: 'timestamptz' })
  fetchedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
