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

export enum CampaignCategory {
  FOOD_AND_BEVERAGE = 'food_and_beverage',
  RESTAURANTS_CAFES = 'restaurants_cafes',
  COFFEE_TEA = 'coffee_tea',
  GROCERY_MARKETS = 'grocery_markets',
  BEAUTY_WELLNESS = 'beauty_wellness',
  FITNESS_SPORTS = 'fitness_sports',
  HEALTH_MEDICAL = 'health_medical',
  RETAIL = 'retail',
  FASHION_APPAREL = 'fashion_apparel',
  EXPERIENCES = 'experiences',
  ENTERTAINMENT = 'entertainment',
  EVENTS_NIGHTLIFE = 'events_nightlife',
  TRAVEL_HOSPITALITY = 'travel_hospitality',
  HOME_SERVICES = 'home_services',
  AUTOMOTIVE = 'automotive',
  EDUCATION = 'education',
  PROFESSIONAL_SERVICES = 'professional_services',
  OTHER = 'other',
}

export const CAMPAIGN_CATEGORY_LABELS: Record<CampaignCategory, string> = {
  [CampaignCategory.FOOD_AND_BEVERAGE]: 'Food & Beverage',
  [CampaignCategory.RESTAURANTS_CAFES]: 'Restaurants & Cafes',
  [CampaignCategory.COFFEE_TEA]: 'Coffee & Tea',
  [CampaignCategory.GROCERY_MARKETS]: 'Grocery & Markets',
  [CampaignCategory.BEAUTY_WELLNESS]: 'Beauty & Wellness',
  [CampaignCategory.FITNESS_SPORTS]: 'Fitness & Sports',
  [CampaignCategory.HEALTH_MEDICAL]: 'Health & Medical',
  [CampaignCategory.RETAIL]: 'Retail',
  [CampaignCategory.FASHION_APPAREL]: 'Fashion & Apparel',
  [CampaignCategory.EXPERIENCES]: 'Experiences',
  [CampaignCategory.ENTERTAINMENT]: 'Entertainment',
  [CampaignCategory.EVENTS_NIGHTLIFE]: 'Events & Nightlife',
  [CampaignCategory.TRAVEL_HOSPITALITY]: 'Travel & Hospitality',
  [CampaignCategory.HOME_SERVICES]: 'Home Services',
  [CampaignCategory.AUTOMOTIVE]: 'Automotive',
  [CampaignCategory.EDUCATION]: 'Education',
  [CampaignCategory.PROFESSIONAL_SERVICES]: 'Professional Services',
  [CampaignCategory.OTHER]: 'Other',
};

export function campaignCategoryLabel(category: CampaignCategory): string {
  return CAMPAIGN_CATEGORY_LABELS[category] ?? CAMPAIGN_CATEGORY_LABELS[CampaignCategory.OTHER];
}

export function parseCampaignCategory(raw: unknown): CampaignCategory {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return (
    (Object.values(CampaignCategory) as string[]).includes(value)
      ? (value as CampaignCategory)
      : CampaignCategory.OTHER
  );
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

  @Column({
    name: 'campaign_category',
    type: 'enum',
    enum: CampaignCategory,
    default: CampaignCategory.OTHER,
  })
  campaignCategory!: CampaignCategory;

  @Column({ name: 'website_url', type: 'varchar', length: 2048 })
  websiteUrl!: string;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

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
