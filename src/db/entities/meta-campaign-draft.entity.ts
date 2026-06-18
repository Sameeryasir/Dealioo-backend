import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Local draft for the 4-step Meta campaign builder (no Meta API until publish). */
@Entity('meta_campaign_drafts')
export class MetaCampaignDraft {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({ name: 'restaurant_id', type: 'int' })
  restaurantId: number;

  /** Builder UI step: 1 Campaign, 2 Ad Set, 3 Ad/Creative, 4 Review */
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
