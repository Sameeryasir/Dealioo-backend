import {
  CreateDateColumn,
  Column,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Business } from './business.entity';
import type { FunnelPage } from './funnel-page.entity';
import type { FunnelPayment } from './funnel-payment.entity';
import type { FunnelVersion } from './funnel-version.entity';
import type { Campaign } from './campaign.entity';
import type { User } from './user.entity';
@Entity('funnels')
export class Funnel {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'campaign_id' })
  campaignId: number;

  @OneToOne(() => require('./campaign.entity').Campaign, (campaign) => campaign.funnel, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @Column({ name: 'business_id', type: 'int', nullable: true })
  businessId: number | null;

  @ManyToOne(() => require('./business.entity').Business, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'business_id' })
  business: Business | null;

  pages?: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  published: boolean;

  @Column({ name: 'content_revision', type: 'int', default: 0 })
  contentRevision: number;

  @ManyToOne(() => require('./user.entity').User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'updated_by' })
  updatedBy: User | null;

  @OneToMany(() => require('./funnel-payment.entity').FunnelPayment, (payment) => payment.funnel)
  payments: FunnelPayment[];

  @OneToMany(() => require('./funnel-version.entity').FunnelVersion, (version) => version.funnel)
  versions: FunnelVersion[];

  @OneToMany(() => require('./funnel-page.entity').FunnelPage, (page) => page.funnel)
  pageRows: FunnelPage[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
