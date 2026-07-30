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
import { Business } from './business.entity';
import { Customer } from './customer.entity';

export enum CustomerActivityType {
  ONLINE_SIGNUP = 'ONLINE_SIGNUP',
  ONLINE_PURCHASE = 'ONLINE_PURCHASE',
  IN_STORE_PURCHASE = 'IN_STORE_PURCHASE',
  REDEMPTION = 'REDEMPTION',
  REFUND = 'REFUND',
}

export enum CustomerActivitySource {
  ONLINE = 'ONLINE',
  SCANNER = 'SCANNER',
  STAFF = 'STAFF',
}

export enum CustomerActivityReferenceType {
  ORDER = 'ORDER',
  FUNNEL_PAYMENT = 'FUNNEL_PAYMENT',
  COUPON = 'COUPON',
}

@Entity('customer_activity')
@Index('IDX_customer_activity_business_customer_created', [
  'businessId',
  'customerId',
  'createdAt',
])
@Index('IDX_customer_activity_type_ref', [
  'activityType',
  'referenceType',
  'referenceId',
])
@Index('UQ_customer_activity_idempotency', ['idempotencyKey'], { unique: true })
export class CustomerActivity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'business_id', type: 'int' })
  businessId!: number;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business!: Business;

  @Column({ name: 'customer_id', type: 'int' })
  customerId!: number;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ name: 'activity_type', type: 'varchar', length: 32 })
  activityType!: CustomerActivityType;

  @Column({ type: 'varchar', length: 32 })
  source!: CustomerActivitySource;

  @Column({ name: 'reference_type', type: 'varchar', length: 32, nullable: true })
  referenceType!: CustomerActivityReferenceType | null;

  @Column({ name: 'reference_id', type: 'varchar', length: 64, nullable: true })
  referenceId!: string | null;

  @Column({ type: 'int', nullable: true })
  amount!: number | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  currency!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 180 })
  idempotencyKey!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
