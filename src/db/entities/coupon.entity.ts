/**
 * Per-customer pass issued after a paid funnel purchase.
 * Each coupon gets its own unique qrToken — not shared at campaign/funnel level.
 */
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
import { Campaign } from './campaign.entity';
import { Customer } from './customer.entity';
import { Funnel } from './funnel.entity';
import { FunnelPayment } from './funnel-payment.entity';
import { Restaurant } from './restaurant.entity';

export enum CouponStatus {
  ACTIVE = 'ACTIVE',
  REDEEMED = 'REDEEMED',
  EXPIRED = 'EXPIRED',
}

export enum CouponPaymentStatus {
  PAID = 'PAID',
  PENDING = 'PENDING',
  REFUNDED = 'REFUNDED',
}

@Entity('coupons')
@Index('IDX_coupons_qr_token', ['qrToken'], { unique: true })
@Index('IDX_coupons_funnel_payment', ['funnelPaymentId'], { unique: true })
export class Coupon {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'campaign_id' })
  campaignId: number;

  @ManyToOne(() => Campaign, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @Column({ name: 'funnel_id' })
  funnelId: number;

  @ManyToOne(() => Funnel, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'funnel_id' })
  funnel: Funnel;

  @Column({ name: 'restaurant_id' })
  restaurantId: number;

  @ManyToOne(() => Restaurant, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'restaurant_id' })
  restaurant: Restaurant;

  @Column({ name: 'customer_id' })
  customerId: number;

  @ManyToOne(() => Customer, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'funnel_payment_id', type: 'int', nullable: true })
  funnelPaymentId: number | null;

  @ManyToOne(() => FunnelPayment, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'funnel_payment_id' })
  funnelPayment: FunnelPayment | null;

  @Column({ name: 'qr_token', type: 'varchar', length: 64 })
  qrToken: string;

  @Column({
    type: 'varchar',
    length: 32,
    default: CouponStatus.ACTIVE,
  })
  status: CouponStatus;

  @Column({
    name: 'payment_status',
    type: 'varchar',
    length: 32,
    default: CouponPaymentStatus.PAID,
  })
  paymentStatus: CouponPaymentStatus;

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt: Date;

  @Column({ name: 'redeemed_at', type: 'timestamptz', nullable: true })
  redeemedAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
