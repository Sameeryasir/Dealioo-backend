import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';
import { Coupon } from './coupon.entity';
import { Customer } from './customer.entity';
import { Business } from './business.entity';
import { User } from './user.entity';

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

  @ManyToOne(() => Customer, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'campaign_id' })
  campaignId: number;

  @ManyToOne(() => Campaign, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @Column({ name: 'restaurant_id' })
  businessId: number;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id' })
  business: Business;

  @Column({ name: 'coupon_id' })
  couponId: number;

  @ManyToOne(() => Coupon, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'coupon_id' })
  coupon: Coupon;

  @Column({ name: 'staff_user_id', type: 'int', nullable: true })
  staffUserId: number | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
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
