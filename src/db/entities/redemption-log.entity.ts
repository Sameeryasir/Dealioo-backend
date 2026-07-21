/**
 * Audit log for every QR scan attempt (success or failure).
 */
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';
import { Coupon } from './coupon.entity';
import { Customer } from './customer.entity';
import { Business } from './business.entity';

/** Audit event type for every preview and redemption attempt. */
export enum RedemptionEventType {
  PREVIEW_SUCCESS = 'PREVIEW_SUCCESS',
  PREVIEW_FAILURE = 'PREVIEW_FAILURE',
  REDEEM_SUCCESS = 'REDEEM_SUCCESS',
  REDEEM_FAILURE = 'REDEEM_FAILURE',
}

@Entity('redemption_logs')
export class RedemptionLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'coupon_id', type: 'int', nullable: true })
  couponId: number | null;

  @ManyToOne(() => Coupon, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'coupon_id' })
  coupon: Coupon | null;

  @Column({ name: 'customer_id', type: 'int', nullable: true })
  customerId: number | null;

  @ManyToOne(() => Customer, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer | null;

  @Column({ name: 'campaign_id', type: 'int', nullable: true })
  campaignId: number | null;

  @ManyToOne(() => Campaign, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign | null;

  @Column({ name: 'restaurant_id', type: 'int' })
  businessId: number;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id' })
  business: Business;

  @Column({ name: 'scanned_by', type: 'int', nullable: true })
  scannedBy: number | null;

  @Column({ name: 'scanned_at', type: 'timestamptz' })
  scannedAt: Date;

  @Column({ name: 'device_info', type: 'text', nullable: true })
  deviceInfo: string | null;

  @Column({ type: 'boolean', default: false })
  success: boolean;

  @Column({ name: 'failure_reason', type: 'varchar', length: 255, nullable: true })
  failureReason: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 32, nullable: true })
  eventType: RedemptionEventType | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true })
  idempotencyKey: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
