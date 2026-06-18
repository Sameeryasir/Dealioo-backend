import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Tracks Meta campaigns created via our app (Meta is source of truth). */
@Entity('facebook_campaigns')
export class FacebookCampaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'int', nullable: true })
  userId: number | null;

  @Column({ name: 'restaurant_id', type: 'int' })
  restaurantId: number;

  @Column({ name: 'ad_account_id', type: 'varchar', length: 64 })
  adAccountId: string;

  @Column({ name: 'meta_campaign_id', type: 'varchar', length: 64, nullable: true })
  metaCampaignId: string | null;

  @Column({ name: 'meta_adset_id', type: 'varchar', length: 64, nullable: true })
  metaAdsetId: string | null;

  @Column({ name: 'meta_creative_id', type: 'varchar', length: 64, nullable: true })
  metaCreativeId: string | null;

  @Column({ name: 'meta_ad_id', type: 'varchar', length: 64, nullable: true })
  metaAdId: string | null;

  @Column({ name: 'campaign_name', type: 'varchar', length: 255, nullable: true })
  campaignName: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  objective: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  budget: string | null;

  @Column({ name: 'start_time', type: 'timestamptz', nullable: true })
  startTime: Date | null;

  @Column({ name: 'end_time', type: 'timestamptz', nullable: true })
  endTime: Date | null;

  @Column({ name: 'facebook_page_id', type: 'varchar', length: 64, nullable: true })
  facebookPageId: string | null;

  @Column({
    name: 'instagram_actor_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  instagramActorId: string | null;

  @Column({ type: 'varchar', length: 32, default: 'PENDING' })
  status: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
