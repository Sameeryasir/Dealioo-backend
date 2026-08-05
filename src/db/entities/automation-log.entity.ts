import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { AutomationExecution } from './automation-execution.entity';
import type { AutomationNode } from './automation-node.entity';
import type { Customer } from './customer.entity';
@Entity('automation_log')
export class AutomationLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'execution_id' })
  executionId: number;

  @ManyToOne(() => require('./automation-execution.entity').AutomationExecution, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'execution_id' })
  execution: AutomationExecution;

  @Column({ name: 'node_id' })
  nodeId: number;

  @ManyToOne(() => require('./automation-node.entity').AutomationNode, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'node_id' })
  node: AutomationNode;

  @Column({ name: 'customer_id', nullable: false })
  customerId: number;

  @ManyToOne(() => require('./customer.entity').Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
