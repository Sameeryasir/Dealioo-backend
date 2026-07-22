import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AutomationLog } from './automation-log.entity';
import { Automation } from './automation.entity';
import { AutomationNode } from './automation-node.entity';
import { Customer } from './customer.entity';
import { AutomationPurpose } from './automation-purpose.enum';

export enum AutomationExecutionStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  WAITING = 'waiting',
  PAUSED = 'paused',
  FAILED = 'failed',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  TIMED_OUT = 'timed_out',
}

export { AutomationPurpose as AutomationExecutionPurpose };

@Entity('automation_execution')
export class AutomationExecution {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'automation_id' })
  automationId: number;

  @ManyToOne(() => Automation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'automation_id' })
  automation: Automation;

  @Column({ name: 'customer_id', nullable: false })
  customerId: number;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'current_node_id' })
  currentNodeId: number;

  @ManyToOne(() => AutomationNode, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'current_node_id' })
  currentNode: AutomationNode;

  @Column({
    type: 'varchar',
    length: 32,
    default: AutomationExecutionStatus.RUNNING,
  })
  status: AutomationExecutionStatus;

  @Column({ name: 'queue_job_id', type: 'varchar', length: 64, nullable: true })
  queueJobId: string | null;

  @Column({ name: 'total_recipients', type: 'int', default: 0 })
  totalRecipients: number;

  @Column({ name: 'emails_sent_count', type: 'int', default: 0 })
  emailsSentCount: number;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'attempt_number', type: 'int', default: 1 })
  attemptNumber!: number;

  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
  nextRetryAt!: Date | null;

  @Column({ name: 'recipients_found', type: 'int', default: 0 })
  recipientsFound!: number;

  @Column({ name: 'recipients_eligible', type: 'int', default: 0 })
  recipientsEligible!: number;

  @Column({ name: 'recipients_filtered', type: 'int', default: 0 })
  recipientsFiltered!: number;

  @Column({ name: 'recipients_sent', type: 'int', default: 0 })
  recipientsSent!: number;

  @Column({ name: 'recipients_failed', type: 'int', default: 0 })
  recipientsFailed!: number;

  @Column({ name: 'recipients_skipped', type: 'int', default: 0 })
  recipientsSkipped!: number;

  @Column({ name: 'recipients_bounced', type: 'int', default: 0 })
  recipientsBounced!: number;

  @Column({ name: 'recipients_paid_during_wait', type: 'int', default: 0 })
  recipientsPaidDuringWait!: number;

  @Column({ name: 'pass_emails_sent', type: 'int', default: 0 })
  passEmailsSent!: number;

  @Column({ type: 'jsonb', nullable: true })
  summary!: Record<string, unknown> | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

  /** Automation.version captured when this run started. */
  @Column({ name: 'automation_version', type: 'int', nullable: true })
  automationVersion: number | null;

  /** Mutable state bag: loop counts, branch memory, last condition result, etc. */
  @Column({
    name: 'execution_context',
    type: 'jsonb',
    default: () => "'{}'",
  })
  executionContext: Record<string, unknown>;

  /** Pointer to latest append-only execution event for recovery. */
  @Column({ name: 'last_event_id', type: 'int', nullable: true })
  lastEventId: number | null;

  @Column({
    type: 'enum',
    enum: AutomationPurpose,
    default: AutomationPurpose.MANUAL,
  })
  purpose: AutomationPurpose;

  @OneToMany(() => AutomationLog, (log) => log.execution)
  logs: AutomationLog[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
