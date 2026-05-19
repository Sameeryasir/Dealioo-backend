import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Automation } from './automation.entity';

export enum AutomationNodeType {
  TRIGGER = 'trigger',
  WAIT = 'wait',
  EMAIL = 'email',
  SMS = 'sms',
  WHATSAPP = 'whatsapp',
  CONDITION = 'condition',
  COUPON = 'coupon',
  TAG = 'tag',
}

@Entity('automation_node')
export class AutomationNode {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'automation_id' })
  automationId: number;

  @ManyToOne(() => Automation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'automation_id' })
  automation: Automation;

  @Column({
    type: 'enum',
    enum: AutomationNodeType,
  })
  type: AutomationNodeType;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  config: Record<string, unknown>;

  @Column({ name: 'position_x', type: 'int', default: 0 })
  positionX: number;

  @Column({ name: 'position_y', type: 'int', default: 0 })
  positionY: number;

  @Column({ name: 'node_order', type: 'int' })
  order: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
