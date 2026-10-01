import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { Business } from './business.entity';
import type { Customer } from './customer.entity';
import type { User } from './user.entity';

@Entity('customer_tags')
@Unique('UQ_customer_tags_business_customer_tag', [
  'businessId',
  'customerId',
  'tag',
])
@Index('IDX_customer_tags_business_tag', ['businessId', 'tag'])
@Index('IDX_customer_tags_customer', ['customerId'])
export class CustomerTag {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'business_id', type: 'int' })
  businessId!: number;

  @ManyToOne(() => require('./business.entity').Business, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'business_id' })
  business!: Business;

  @Column({ name: 'customer_id', type: 'int' })
  customerId!: number;

  @ManyToOne(() => require('./customer.entity').Customer, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ type: 'varchar', length: 64 })
  tag!: string;

  @Column({ name: 'source', type: 'varchar', length: 64, nullable: true })
  source!: string | null;

  @Column({ name: 'created_by_user_id', type: 'int', nullable: true })
  createdByUserId!: number | null;

  @ManyToOne(() => require('./user.entity').User, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser!: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
