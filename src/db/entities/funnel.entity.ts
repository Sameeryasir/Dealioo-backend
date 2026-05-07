import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';

@Entity('funnels')
export class Funnel {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'campaign_id' })
  campaignId: number;

  @ManyToOne(() => Campaign, (campaign) => campaign.funnels, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @Column({ name: 'lead_name', type: 'varchar', length: 255 })
  leadName: string;

  @Column({ name: 'lead_email', type: 'varchar', length: 255 })
  leadEmail: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
