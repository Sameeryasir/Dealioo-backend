import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Business } from './business.entity';
import { Funnel } from './funnel.entity';
import { User } from './user.entity';

export enum CampaignPublicationStatus {
  PUBLISHED = 'published',
  UNPUBLISHED = 'unpublished',
}

@Entity('campaigns')
export class Campaign {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'restaurant_id' })
  businessId!: number;

  @ManyToOne(() => Business, (business) => business.campaigns, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'restaurant_id' })
  business!: Business;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdByUserId!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser!: User | null;

  @OneToOne(() => Funnel, (funnel) => funnel.campaign, { nullable: true })
  funnel!: Funnel | null;

  @Column({ name: 'campaign_name', type: 'varchar', length: 255 })
  campaignName!: string;

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
}
