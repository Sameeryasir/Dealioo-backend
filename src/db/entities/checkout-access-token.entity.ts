import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Customer } from './customer.entity';
import { FunnelPayment } from './funnel-payment.entity';

@Entity('checkout_access_token')
@Index('IDX_checkout_access_token_customer_funnel', ['customerId', 'funnelId'])
export class CheckoutAccessToken {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'token_hash', type: 'varchar', length: 64, unique: true })
  tokenHash: string;

  @Column({ name: 'customer_id' })
  customerId: number;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'funnel_id' })
  funnelId: number;

  @Column({ name: 'restaurant_id' })
  restaurantId: number;

  @Column({ name: 'campaign_id', type: 'int', nullable: true })
  campaignId: number | null;

  @Column({ name: 'funnel_payment_id', type: 'int', nullable: true })
  funnelPaymentId: number | null;

  @ManyToOne(() => FunnelPayment, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'funnel_payment_id' })
  funnelPayment: FunnelPayment | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
