import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Campaign } from './campaign.entity';
import type { Coupon } from './coupon.entity';
import type { Customer } from './customer.entity';
import type { Business } from './business.entity';
import type { CustomerVisitCampaign } from './customer-visit-campaign.entity';
import type { Order } from './order.entity';
import type { User } from './user.entity';
export enum CustomerVisitSource {
  QR_REDEMPTION = 'QR_REDEMPTION',
  STAFF_LOOKUP = 'STAFF_LOOKUP',
}

@Entity('customer_visits')
@Index('UQ_customer_visits_coupon_id', ['couponId'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class CustomerVisit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'customer_id' })
  customerId: number;

  @ManyToOne(() => require('./customer.entity').Customer, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'campaign_id' })
  campaignId: number;

  @ManyToOne(() => require('./campaign.entity').Campaign, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @OneToMany(() => require('./customer-visit-campaign.entity').CustomerVisitCampaign, (row) => row.customerVisit, {
    cascade: true,
  })
  visitCampaigns: CustomerVisitCampaign[];

  @Column({ name: 'business_id' })
  businessId: number;

  @ManyToOne(() => require('./business.entity').Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business: Business;

  @Column({ name: 'coupon_id', type: 'int', nullable: true })
  couponId: number | null;

  @ManyToOne(() => require('./coupon.entity').Coupon, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'coupon_id' })
  coupon: Coupon | null;

  @Column({ name: 'order_id', type: 'int', nullable: true })
  orderId: number | null;

  @ManyToOne(() => require('./order.entity').Order, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'order_id' })
  order: Order | null;

  @Column({ name: 'staff_user_id', type: 'int', nullable: true })
  staffUserId: number | null;

  @ManyToOne(() => require('./user.entity').User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'staff_user_id' })
  staffUser: User | null;

  @Column({ name: 'visit_date', type: 'timestamptz' })
  visitedAt: Date;

  @Column({
    type: 'varchar',
    length: 32,
    default: CustomerVisitSource.QR_REDEMPTION,
  })
  source: CustomerVisitSource;

  @Column({
    name: 'order_subtotal',
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  orderSubtotal: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
