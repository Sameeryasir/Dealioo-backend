import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Automation } from './automation.entity';
import { AutomationNode } from './automation-node.entity';

@Entity('automation_connection')
export class AutomationConnection {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'automation_id' })
  automationId: number;

  @ManyToOne(() => Automation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'automation_id' })
  automation: Automation;

  @Column({ name: 'source_node_id' })
  sourceNodeId: number;

  @ManyToOne(() => AutomationNode, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_node_id' })
  sourceNode: AutomationNode;

  @Column({ name: 'target_node_id' })
  targetNodeId: number;

  @ManyToOne(() => AutomationNode, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'target_node_id' })
  targetNode: AutomationNode;
}
