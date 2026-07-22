import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Campaign } from './campaign.entity';
import { CustomerVisit } from './customer-visit.entity';

@Entity('customer_visit_campaigns')
@Unique('UQ_customer_visit_campaigns_visit_campaign', [
  'customerVisitId',
  'campaignId',
])
@Index('IDX_customer_visit_campaigns_campaign_id', ['campaignId'])
export class CustomerVisitCampaign {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'customer_visit_id' })
  customerVisitId: number;

  @ManyToOne(() => CustomerVisit, (visit) => visit.visitCampaigns, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'customer_visit_id' })
  customerVisit: CustomerVisit;

  @Column({ name: 'campaign_id' })
  campaignId: number;

  @ManyToOne(() => Campaign, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
