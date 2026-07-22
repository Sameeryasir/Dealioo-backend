import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AutomationExecution } from './automation-execution.entity';
import { AutomationExecutionStep } from './automation-execution-step.entity';
import { AutomationNode } from './automation-node.entity';
import { Customer } from './customer.entity';

export enum AutomationRecipientDeliveryStatus {
  SENT = 'sent',
  SKIPPED = 'skipped',
  ALREADY_PAID = 'already_paid',
  FILTERED = 'filtered',
  FAILED = 'failed',
  BOUNCED = 'bounced',
  PROVIDER_ERROR = 'provider_error',
  LOCK_SKIPPED = 'lock_skipped',
  RETRYING = 'retrying',
}

@Entity('automation_execution_recipient')
export class AutomationExecutionRecipient {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'execution_id' })
  executionId!: number;

  @ManyToOne(() => AutomationExecution, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'execution_id' })
  execution!: AutomationExecution;

  @Column({ name: 'step_id', type: 'int', nullable: true })
  stepId!: number | null;

  @ManyToOne(() => AutomationExecutionStep, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'step_id' })
  step!: AutomationExecutionStep | null;

  @Column({ name: 'customer_id' })
  customerId!: number;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ name: 'node_id', type: 'int', nullable: true })
  nodeId!: number | null;

  @ManyToOne(() => AutomationNode, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'node_id' })
  node!: AutomationNode | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phase!: string | null;

  @Column({ type: 'varchar', length: 32 })
  status!: AutomationRecipientDeliveryStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason!: string | null;

  @Column({ type: 'int', default: 1 })
  attempt!: number;

  @Column({ name: 'provider_response', type: 'jsonb', nullable: true })
  providerResponse!: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
