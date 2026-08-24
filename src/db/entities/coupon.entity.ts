import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Campaign } from './campaign.entity';
import type { Customer } from './customer.entity';
import type { Funnel } from './funnel.entity';
import type { FunnelPayment } from './funnel-payment.entity';
import type { Business } from './business.entity';
import type { User } from './user.entity';
export enum CouponStatus {
  ACTIVE = 'ACTIVE',
  REDEEMED = 'REDEEMED',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

export enum CouponPaymentStatus {
  PAID = 'PAID',
  PENDING = 'PENDING',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  DISPUTED = 'DISPUTED',
}

@Entity('coupons')
@Index('IDX_coupons_qr_token', ['qrToken'], { unique: true })
@Index('IDX_coupons_funnel_payment', ['funnelPaymentId'], { unique: true })
export class Coupon {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'campaign_id' })
  campaignId: number;

  @ManyToOne(() => require('./campaign.entity').Campaign, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @Column({ name: 'funnel_id', type: 'int', nullable: true })
  funnelId!: number;

  @ManyToOne(() => require('./funnel.entity').Funnel, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'funnel_id' })
  funnel!: Funnel;

  @Column({ name: 'business_id' })
  businessId: number;

  @ManyToOne(() => require('./business.entity').Business, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'business_id' })
  business: Business;

  @Column({ name: 'customer_id' })
  customerId: number;

  @ManyToOne(() => require('./customer.entity').Customer, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'funnel_payment_id', type: 'int', nullable: true })
  funnelPaymentId: number | null;

  @ManyToOne(() => require('./funnel-payment.entity').FunnelPayment, { onDelete: 'SET NULL', nullable: true })
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

  @Column({ name: 'redeemed_by_user_id', type: 'int', nullable: true })
  redeemedByUserId: number | null;

  @ManyToOne(() => require('./user.entity').User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'redeemed_by_user_id' })
  redeemedByUser: User | null;

  @Column({ name: 'scanner_device', type: 'varchar', length: 255, nullable: true })
  scannerDevice: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'signup_pass_email_scheduled_at', type: 'timestamptz', nullable: true })
  signupPassEmailScheduledAt: Date | null;

  @Column({ name: 'signup_pass_email_sent_at', type: 'timestamptz', nullable: true })
  signupPassEmailSentAt: Date | null;

  @Column({ name: 'signup_pass_email_cancelled_at', type: 'timestamptz', nullable: true })
  signupPassEmailCancelledAt: Date | null;

  @Column({
    name: 'google_wallet_object_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  googleWalletObjectId: string | null;

  @Column({ name: 'google_wallet_added', type: 'boolean', default: false })
  googleWalletAdded!: boolean;

  @Column({
    name: 'google_wallet_status',
    type: 'varchar',
    length: 32,
    default: 'NOT_ADDED',
  })
  googleWalletStatus!: string;

  @Column({
    name: 'google_wallet_pending_at',
    type: 'timestamptz',
    nullable: true,
  })
  googleWalletPendingAt!: Date | null;

  @Column({ name: 'google_wallet_added_at', type: 'timestamptz', nullable: true })
  googleWalletAddedAt!: Date | null;

  @Column({
    name: 'google_wallet_removed_at',
    type: 'timestamptz',
    nullable: true,
  })
  googleWalletRemovedAt!: Date | null;

  @Column({
    name: 'google_wallet_last_event',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  googleWalletLastEvent!: string | null;

  @Column({
    name: 'google_wallet_last_event_at',
    type: 'timestamptz',
    nullable: true,
  })
  googleWalletLastEventAt!: Date | null;

  @Column({
    name: 'google_wallet_last_synced_at',
    type: 'timestamptz',
    nullable: true,
  })
  googleWalletLastSyncedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
