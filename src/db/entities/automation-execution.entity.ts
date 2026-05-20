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
  RUNNING = 'running',
  WAITING = 'waiting',
  FAILED = 'failed',
  COMPLETED = 'completed',
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

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

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
