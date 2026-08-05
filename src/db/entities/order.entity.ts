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
import type { Business } from './business.entity';
import type { FunnelPayment } from './funnel-payment.entity';
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
@Index('IDX_orders_business_paid_at', ['businessId', 'paidAt'])
export class Order {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'business_id' })
  businessId!: number;

  @ManyToOne(() => require('./business.entity').Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business!: Business;

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

  @OneToMany(() => require('./funnel-payment.entity').FunnelPayment, (payment) => payment.order)
  payments!: FunnelPayment[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
