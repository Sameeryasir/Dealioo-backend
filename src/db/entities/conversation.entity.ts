import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Automation } from './automation.entity';
import { Customer } from './customer.entity';
import { Restaurant } from './restaurant.entity';

@Entity('conversation')
export class Conversation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'restaurant_id' })
  restaurantId: number;

  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id' })
  restaurant: Restaurant;

  @Column({ name: 'customer_id' })
  customerId: number;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'is_private', type: 'boolean', default: true })
  isPrivate: boolean;

  @Column({ name: 'message_count', type: 'int', default: 0 })
  messageCount: number;

  @Column({ name: 'last_message_preview', type: 'text', nullable: true })
  lastMessagePreview: string | null;

  @Column({
    name: 'last_message_channel',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  lastMessageChannel: string | null;

  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt: Date | null;

  @Column({ name: 'last_automation_id', type: 'int', nullable: true })
  lastAutomationId: number | null;

  @ManyToOne(() => Automation, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'last_automation_id' })
  lastAutomation: Automation | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
