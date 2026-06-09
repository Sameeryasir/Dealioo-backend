import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';
import { Coupon } from './coupon.entity';
import { Customer } from './customer.entity';
import { Restaurant } from './restaurant.entity';
import { User } from './user.entity';

export enum CustomerVisitSource {
  QR_REDEMPTION = 'QR_REDEMPTION',
}

@Entity('customer_visits')
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
  restaurantId: number;

  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id' })
  restaurant: Restaurant;

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
}
