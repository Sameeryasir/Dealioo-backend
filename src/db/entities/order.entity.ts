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
  UpdateDateColumn,
} from 'typeorm';
import { Business } from './business.entity';
import { Customer } from './customer.entity';
import { FunnelPayment } from './funnel-payment.entity';
import { User } from './user.entity';

export enum OrderStatus {
  PENDING = 'pending',
  PAID = 'paid',
  REFUNDED = 'refunded',
  CANCELLED = 'cancelled',
}

export enum OrderSource {
  STRIPE = 'STRIPE',
  SCANNER = 'SCANNER',
  MANUAL = 'MANUAL',
}

@Entity('orders')
@Index('IDX_orders_business_customer', ['businessId', 'customerId'])
@Index('IDX_orders_business_paid_at', ['businessId', 'paidAt'])
export class Order {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'restaurant_id' })
  businessId!: number;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id' })
  business!: Business;

  @Column({ name: 'customer_id', type: 'int', nullable: true })
  customerId!: number | null;

  @ManyToOne(() => Customer, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer | null;

  @Column({
    type: 'varchar',
    length: 32,
    enum: OrderStatus,
    default: OrderStatus.PAID,
  })
  status!: OrderStatus;

  @Column({
    type: 'varchar',
    length: 32,
    enum: OrderSource,
    default: OrderSource.SCANNER,
  })
  source!: OrderSource;

  @Column({ name: 'total_amount', type: 'int', default: 0 })
  totalAmount!: number;

  @Column({ type: 'varchar', length: 10, default: 'usd' })
  currency!: string;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({ name: 'collected_by_user_id', type: 'int', nullable: true })
  collectedByUserId!: number | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'collected_by_user_id' })
  collectedByUser!: User | null;

  @OneToMany(() => FunnelPayment, (payment) => payment.order)
  payments!: FunnelPayment[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
