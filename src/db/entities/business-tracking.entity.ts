import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Business } from './business.entity';
@Entity('business_tracking')
@Index('IDX_business_tracking_business_id', ['businessId'], {
  unique: true,
})
export class BusinessTracking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'business_id', type: 'int' })
  businessId: number;

  @ManyToOne(() => require('./business.entity').Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business: Business;

  @Column({ name: 'pixel_id', type: 'varchar', length: 128, nullable: true })
  pixelId: string | null;

  @Column({ name: 'access_token', type: 'text', nullable: true })
  accessToken: string | null;

  @Column({
    name: 'google_tag_manager_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  googleTagManagerId: string | null;

  @Column({
    name: 'google_ads_signup_conversion_label',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  googleAdsSignupConversionLabel: string | null;

  @Column({
    name: 'google_ads_purchase_conversion_label',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  googleAdsPurchaseConversionLabel: string | null;

  @Column({
    name: 'google_ads_lead_conversion_label',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  googleAdsLeadConversionLabel: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
