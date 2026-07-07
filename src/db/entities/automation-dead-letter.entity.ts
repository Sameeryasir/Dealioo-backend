import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AutomationExecution } from './automation-execution.entity';

export enum AutomationDeadLetterStatus {
  PENDING = 'pending',
  RETRIED = 'retried',
  DISCARDED = 'discarded',
}

@Entity('automation_dead_letter')
export class AutomationDeadLetter {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'execution_id', type: 'int', nullable: true })
  executionId: number | null;

  @ManyToOne(() => AutomationExecution, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'execution_id' })
  execution: AutomationExecution | null;

  @Column({ name: 'automation_id', type: 'int', nullable: true })
  automationId: number | null;

  @Column({ name: 'customer_id', type: 'int', nullable: true })
  customerId: number | null;

  @Column({ name: 'job_name', type: 'varchar', length: 64 })
  jobName: string;

  @Column({ name: 'job_id', type: 'varchar', length: 128 })
  jobId: string;

  @Column({ name: 'job_data', type: 'jsonb', default: () => "'{}'" })
  jobData: Record<string, unknown>;

  @Column({ name: 'node_id', type: 'int', nullable: true })
  nodeId: number | null;

  @Column({ name: 'node_type', type: 'varchar', length: 32, nullable: true })
  nodeType: string | null;

  @Column({ type: 'text' })
  error: string;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'varchar', length: 32, default: AutomationDeadLetterStatus.PENDING })
  status: AutomationDeadLetterStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'retried_at', type: 'timestamptz', nullable: true })
  retriedAt: Date | null;
}
