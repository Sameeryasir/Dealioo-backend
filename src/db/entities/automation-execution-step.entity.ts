import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AutomationExecution } from './automation-execution.entity';
import { AutomationNode } from './automation-node.entity';

export enum AutomationExecutionStepStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  WAITING = 'waiting',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

@Entity('automation_execution_step')
export class AutomationExecutionStep {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'execution_id' })
  executionId!: number;

  @ManyToOne(() => AutomationExecution, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'execution_id' })
  execution!: AutomationExecution;

  @Column({ name: 'node_id', type: 'int', nullable: true })
  nodeId!: number | null;

  @ManyToOne(() => AutomationNode, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'node_id' })
  node!: AutomationNode | null;

  @Column({ name: 'step_key', type: 'varchar', length: 64 })
  stepKey!: string;

  @Column({ name: 'step_label', type: 'varchar', length: 255 })
  stepLabel!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phase!: string | null;

  @Column({
    type: 'varchar',
    length: 32,
    default: AutomationExecutionStepStatus.PENDING,
  })
  status!: AutomationExecutionStepStatus;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs!: number | null;

  @Column({ name: 'recipients_total', type: 'int', default: 0 })
  recipientsTotal!: number;

  @Column({ name: 'recipients_sent', type: 'int', default: 0 })
  recipientsSent!: number;

  @Column({ name: 'recipients_failed', type: 'int', default: 0 })
  recipientsFailed!: number;

  @Column({ name: 'recipients_skipped', type: 'int', default: 0 })
  recipientsSkipped!: number;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
