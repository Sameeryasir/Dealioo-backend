import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Restaurant } from './restaurant.entity';

export enum FunnelPublicationStatus {
  PUBLISHED = 'published',
  UNPUBLISHED = 'unpublished',
}

@Entity('funnels')
export class Funnel {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'restaurant_id' })
  restaurantId: number;

  @ManyToOne(() => Restaurant, (restaurant) => restaurant.funnels, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'restaurant_id' })
  restaurant: Restaurant;

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
    enum: FunnelPublicationStatus,
    default: FunnelPublicationStatus.UNPUBLISHED,
  })
  status: FunnelPublicationStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
