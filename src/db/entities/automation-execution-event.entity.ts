import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AutomationExecution } from './automation-execution.entity';
import { AutomationNode } from './automation-node.entity';

export enum AutomationExecutionEventType {
  EXECUTION_CREATED = 'execution_created',
  EXECUTION_STARTED = 'execution_started',
  NODE_STARTED = 'node_started',
  NODE_ENTERED = 'node_entered',
  NODE_COMPLETED = 'node_completed',
  NODE_FAILED = 'node_failed',
  WAIT_SCHEDULED = 'wait_scheduled',
  WAIT_COMPLETED = 'wait_completed',
  EXECUTION_WAITING = 'execution_waiting',
  EXECUTION_RESUMED = 'execution_resumed',
  CONDITION_EVALUATED = 'condition_evaluated',
  LOOP_RESTART = 'loop_restart',
  RETRY_SCHEDULED = 'retry_scheduled',
  RETRY_COMPLETED = 'retry_completed',
  EXECUTION_COMPLETED = 'execution_completed',
  EXECUTION_FAILED = 'execution_failed',
  EXECUTION_CANCELLED = 'execution_cancelled',
  EXECUTION_PAUSED = 'execution_paused',
  EXECUTION_TIMED_OUT = 'execution_timed_out',
  RECOVERY_APPLIED = 'recovery_applied',
}

@Entity('automation_execution_event')
export class AutomationExecutionEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'execution_id' })
  executionId: number;

  @ManyToOne(() => AutomationExecution, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'execution_id' })
  execution: AutomationExecution;

  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  eventType: AutomationExecutionEventType;

  @Column({ name: 'node_id', type: 'int', nullable: true })
  nodeId: number | null;

  @ManyToOne(() => AutomationNode, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'node_id' })
  node: AutomationNode | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
