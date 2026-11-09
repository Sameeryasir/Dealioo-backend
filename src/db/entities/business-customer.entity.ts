import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { Business } from './business.entity';
import type { Customer } from './customer.entity';
@Entity('business_customers')
@Unique('UQ_business_customers_business_customer', ['business', 'customer'])
export class BusinessCustomer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'business_id' })
  businessId: number;

  @ManyToOne(
    () => require('./business.entity').Business,
    (business: Business) => business.businessCustomers,
    {
      nullable: false,
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'business_id' })
  business: Business;

  @Column({ name: 'customer_id' })
  customerId: number;

  @ManyToOne(
    () => require('./customer.entity').Customer,
    (customer: Customer) => customer.businessCustomers,
    {
      nullable: false,
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'joined_at', type: 'timestamptz' })
  joinedAt: Date;

  @Column({ name: 'sms_opted_out', type: 'boolean', default: false })
  smsOptedOut: boolean;

  @Column({ name: 'sms_opted_out_at', type: 'timestamptz', nullable: true })
  smsOptedOutAt: Date | null;

  @Column({ name: 'sms_opt_out_source', type: 'varchar', length: 64, nullable: true })
  smsOptOutSource: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
