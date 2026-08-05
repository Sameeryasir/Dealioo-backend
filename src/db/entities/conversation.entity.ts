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
import type { Automation } from './automation.entity';
import type { Customer } from './customer.entity';
import type { Business } from './business.entity';
@Entity('conversation')
@Unique('UQ_conversation_business_customer', ['businessId', 'customerId'])
export class Conversation {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'business_id' })
  businessId!: number;

  @ManyToOne(() => require('./business.entity').Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business!: Business;

  @Column({ name: 'customer_id' })
  customerId!: number;

  @ManyToOne(() => require('./customer.entity').Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ name: 'is_private', type: 'boolean', default: true })
  isPrivate!: boolean;

  @Column({ name: 'message_count', type: 'int', default: 0 })
  messageCount!: number;

  @Column({ name: 'last_message_preview', type: 'text', nullable: true })
  lastMessagePreview!: string | null;

  @Column({
    name: 'last_message_channel',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  lastMessageChannel!: string | null;

  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt!: Date | null;

  @Column({ name: 'last_automation_id', type: 'int', nullable: true })
  lastAutomationId!: number | null;

  @ManyToOne(() => require('./automation.entity').Automation, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'last_automation_id' })
  lastAutomation!: Automation | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
