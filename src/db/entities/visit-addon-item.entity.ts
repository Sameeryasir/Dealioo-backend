import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Business } from './business.entity';
import type { Campaign } from './campaign.entity';
import type { Customer } from './customer.entity';
import type { CustomerVisit } from './customer-visit.entity';
import type { FunnelPayment } from './funnel-payment.entity';
import type { Order } from './order.entity';
import type { User } from './user.entity';

export enum VisitAddonItemSource {
  SCANNER_PURCHASE = 'scanner_purchase',
  QR_REDEEM = 'qr_redeem',
  PREPAID_EXTRAS_ONLY = 'prepaid_extras_only',
}

@Entity('visit_addon_items')
@Index('IDX_visit_addon_items_visit_id', ['customerVisitId'])
@Index('IDX_visit_addon_items_business_id', ['businessId'])
@Index('IDX_visit_addon_items_order_id', ['orderId'])
export class VisitAddonItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'customer_visit_id', type: 'int' })
  customerVisitId: number;

  @ManyToOne(
    () => require('./customer-visit.entity').CustomerVisit,
    (visit: CustomerVisit) => visit.addonItems,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'customer_visit_id' })
  customerVisit: CustomerVisit;

  @Column({ name: 'business_id', type: 'int' })
  businessId: number;

  @ManyToOne(() => require('./business.entity').Business, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'business_id' })
  business: Business;

  @Column({ name: 'customer_id', type: 'int' })
  customerId: number;

  @ManyToOne(() => require('./customer.entity').Customer, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ name: 'unit_price_cents', type: 'int' })
  unitPriceCents: number;

  @Column({ type: 'int', default: 1 })
  qty: number;

  @Column({ name: 'line_total_cents', type: 'int' })
  lineTotalCents: number;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'order_id', type: 'int', nullable: true })
  orderId: number | null;

  @ManyToOne(() => require('./order.entity').Order, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'order_id' })
  order: Order | null;

  @Column({ name: 'funnel_payment_id', type: 'int', nullable: true })
  funnelPaymentId: number | null;

  @ManyToOne(() => require('./funnel-payment.entity').FunnelPayment, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'funnel_payment_id' })
  funnelPayment: FunnelPayment | null;

  @Column({ name: 'campaign_id', type: 'int', nullable: true })
  campaignId: number | null;

  @ManyToOne(() => require('./campaign.entity').Campaign, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign | null;

  @Column({ name: 'staff_user_id', type: 'int', nullable: true })
  staffUserId: number | null;

  @ManyToOne(() => require('./user.entity').User, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'staff_user_id' })
  staffUser: User | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  source: VisitAddonItemSource | string | null;

  @Column({ type: 'varchar', length: 10, default: 'usd' })
  currency: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
