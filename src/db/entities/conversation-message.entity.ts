import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Automation } from './automation.entity';
import { AutomationExecution } from './automation-execution.entity';
import { AutomationNode } from './automation-node.entity';
import { Conversation } from './conversation.entity';
import { Customer } from './customer.entity';
import { Restaurant } from './restaurant.entity';

export enum ConversationMessageChannel {
  EMAIL = 'email',
  SMS = 'sms',
  WHATSAPP = 'whatsapp',
}

export enum ConversationMessageDirection {
  OUTBOUND = 'outbound',
  INBOUND = 'inbound',
}

@Entity('conversation_message')
export class ConversationMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'conversation_id' })
  conversationId: number;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column({ name: 'automation_id', type: 'int', nullable: true })
  automationId: number | null;

  @ManyToOne(() => Automation, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'automation_id' })
  automation: Automation | null;

  @Column({ name: 'execution_id', type: 'int', nullable: true })
  executionId: number | null;

  @ManyToOne(() => AutomationExecution, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'execution_id' })
  execution: AutomationExecution | null;

  @Column({ name: 'node_id', type: 'int', nullable: true })
  nodeId: number | null;

  @ManyToOne(() => AutomationNode, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'node_id' })
  node: AutomationNode | null;

  @Column({ type: 'varchar', length: 16 })
  channel: ConversationMessageChannel;

  @Column({
    type: 'varchar',
    length: 16,
    default: ConversationMessageDirection.OUTBOUND,
  })
  direction: ConversationMessageDirection;

  @Column({ name: 'sent_by_restaurant_id', type: 'int', nullable: true })
  sentByRestaurantId: number | null;

  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'sent_by_restaurant_id' })
  sentByRestaurant: Restaurant | null;

  @Column({ name: 'sent_by_customer_id', type: 'int', nullable: true })
  sentByCustomerId: number | null;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'sent_by_customer_id' })
  sentByCustomer: Customer | null;

  @Column({ name: 'sent_to_restaurant_id', type: 'int', nullable: true })
  sentToRestaurantId: number | null;

  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'sent_to_restaurant_id' })
  sentToRestaurant: Restaurant | null;

  @Column({ name: 'sent_to_customer_id', type: 'int', nullable: true })
  sentToCustomerId: number | null;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'sent_to_customer_id' })
  sentToCustomer: Customer | null;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: 'sent_at', type: 'timestamptz' })
  sentAt: Date;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 160 })
  idempotencyKey: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
