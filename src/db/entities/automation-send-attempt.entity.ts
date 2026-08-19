import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('automation_send_attempt')
@Index('UQ_automation_send_attempt_key', [
  'automationId',
  'customerId',
  'actionType',
  'attempt',
], { unique: true })
export class AutomationSendAttempt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'automation_id', type: 'int' })
  automationId: number;

  @Column({ name: 'customer_id', type: 'int' })
  customerId: number;

  @Column({ name: 'action_type', type: 'varchar', length: 64 })
  actionType: string;

  @Column({ type: 'int' })
  attempt: number;

  @Column({ name: 'execution_id', type: 'int', nullable: true })
  executionId: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
