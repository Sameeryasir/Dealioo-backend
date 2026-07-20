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
import { Business } from './business.entity';
import { Customer } from './customer.entity';

@Entity('business_customers')
@Unique('UQ_business_customers_business_customer', ['business', 'customer'])
export class BusinessCustomer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'business_id' })
  businessId: number;

  @ManyToOne(() => Business, (business) => business.businessCustomers, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'business_id' })
  business: Business;

  @Column({ name: 'customer_id' })
  customerId: number;

  @ManyToOne(() => Customer, (customer) => customer.businessCustomers, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'joined_at', type: 'timestamptz' })
  joinedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
