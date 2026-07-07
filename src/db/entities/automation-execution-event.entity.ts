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
  EXECUTION_STARTED = 'execution_started',
  NODE_ENTERED = 'node_entered',
  NODE_COMPLETED = 'node_completed',
  NODE_FAILED = 'node_failed',
  WAIT_SCHEDULED = 'wait_scheduled',
  WAIT_COMPLETED = 'wait_completed',
  CONDITION_EVALUATED = 'condition_evaluated',
  LOOP_RESTART = 'loop_restart',
  EXECUTION_COMPLETED = 'execution_completed',
  EXECUTION_FAILED = 'execution_failed',
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
