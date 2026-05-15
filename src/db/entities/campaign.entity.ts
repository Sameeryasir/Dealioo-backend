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
import { Restaurant } from './restaurant.entity';
import { Funnel } from './funnel.entity';

export enum CampaignPublicationStatus {
  PUBLISHED = 'published',
  UNPUBLISHED = 'unpublished',
}

@Entity('campaigns')
export class Campaign {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'restaurant_id' })
  restaurantId: number;

  @ManyToOne(() => Restaurant, (restaurant) => restaurant.campaigns, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'restaurant_id' })
  restaurant: Restaurant;

  /** Each campaign has at most one funnel (`funnels.campaign_id` is unique). */
  @OneToOne(() => Funnel, (funnel) => funnel.campaign, { nullable: true })
  funnel: Funnel | null;

  @Column({ name: 'campaign_name', type: 'varchar', length: 255 })
  campaignName: string;

  @Column({ name: 'website_url', type: 'varchar', length: 2048 })
  websiteUrl: string;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl: string | null;

  @Column({ type: 'text', nullable: true })
  offer: string | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  price: number | null;

  @Column({
    type: 'enum',
    enum: CampaignPublicationStatus,
    default: CampaignPublicationStatus.UNPUBLISHED,
  })
  status: CampaignPublicationStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
