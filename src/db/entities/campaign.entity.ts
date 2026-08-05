import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Business } from './business.entity';
import type { Funnel } from './funnel.entity';
import type { User } from './user.entity';
export enum CampaignPublicationStatus {
  PUBLISHED = 'published',
  UNPUBLISHED = 'unpublished',
}

export enum CampaignType {
  PREPAID = 'prepaid',
  POSTPAID = 'postpaid',
}

@Entity('campaigns')
export class Campaign {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'business_id' })
  businessId!: number;

  @ManyToOne(() => require('./business.entity').Business, (business) => business.campaigns, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'business_id' })
  business!: Business;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdByUserId!: number | null;

  @ManyToOne(() => require('./user.entity').User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser!: User | null;

  @OneToOne(() => require('./funnel.entity').Funnel, (funnel) => funnel.campaign, { nullable: true })
  funnel!: Funnel | null;

  @Column({ name: 'campaign_name', type: 'varchar', length: 255 })
  campaignName!: string;

  @Column({
    name: 'campaign_type',
    type: 'enum',
    enum: CampaignType,
    default: CampaignType.PREPAID,
  })
  campaignType!: CampaignType;

  @Column({ name: 'website_url', type: 'varchar', length: 2048 })
  websiteUrl!: string;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  offer!: string | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  price!: number | null;

  @Column({
    type: 'enum',
    enum: CampaignPublicationStatus,
    default: CampaignPublicationStatus.UNPUBLISHED,
  })
  status!: CampaignPublicationStatus;

  @Column({ name: 'stripe_product_id', type: 'varchar', length: 255, nullable: true })
  stripeProductId!: string | null;

  @Column({ name: 'stripe_price_id', type: 'varchar', length: 255, nullable: true })
  stripePriceId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
