import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('google_ad_campaign_stats_snapshots')
@Index(
  'UQ_google_ad_campaign_stats_snapshots_biz_customer_preset',
  ['businessId', 'customerId', 'datePreset'],
  { unique: true },
)
@Index('IDX_google_ad_campaign_stats_snapshots_business', ['businessId'])
export class GoogleAdCampaignStatsSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'business_id', type: 'int' })
  businessId!: number;

  @Column({ name: 'customer_id', type: 'varchar', length: 64 })
  customerId!: string;

  @Column({ name: 'date_preset', type: 'varchar', length: 32 })
  datePreset!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'fetched_at', type: 'timestamptz' })
  fetchedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
