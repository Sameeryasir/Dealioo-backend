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
import type { AutomationConnection } from './automation-connection.entity';
import type { AutomationExecution } from './automation-execution.entity';
import type { AutomationNode } from './automation-node.entity';
import type { Campaign } from './campaign.entity';
import type { Funnel } from './funnel.entity';
import type { Business } from './business.entity';
import type { User } from './user.entity';
import { AutomationPurpose } from './automation-purpose.enum';

export enum AutomationTrigger {
  SIGNUP = 'signup',
  PAYMENT = 'payment',
  FUNNEL_COMPLETED = 'funnel_completed',
  ABANDONED_CHECKOUT = 'abandoned_checkout',
  FIRST_PURCHASE = 'first_purchase',
  NO_VISIT = 'no_visit',
  CRON = 'cron',
}

@Entity('automation')
export class Automation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'business_id' })
  businessId: number;

  @ManyToOne(() => require('./business.entity').Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business: Business;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: AutomationTrigger,
  })
  trigger: AutomationTrigger;

  @Column({
    type: 'enum',
    enum: AutomationPurpose,
    default: AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER,
  })
  purpose: AutomationPurpose;

  @Column({ name: 'campaign_id', nullable: true })
  campaignId: number | null;

  @ManyToOne(() => require('./campaign.entity').Campaign, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign | null;

  @Column({ name: 'funnel_id', nullable: true })
  funnelId: number | null;

  @ManyToOne(() => require('./funnel.entity').Funnel, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'funnel_id' })
  funnel: Funnel | null;

  @Column({ name: 'created_by' })
  createdBy: number;

  @ManyToOne(() => require('./user.entity').User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean;

  @Column({ type: 'boolean', default: false })
  published: boolean;

  @Column({ name: 'is_template', type: 'boolean', default: false })
  isTemplate: boolean;

  /** Incremented when flow is published or graph changes — frozen on each execution start. */
  @Column({ type: 'int', default: 1 })
  version: number;

  @OneToMany(() => require('./automation-node.entity').AutomationNode, (node) => node.automation)
  nodes: AutomationNode[];

  @OneToMany(() => require('./automation-connection.entity').AutomationConnection, (connection) => connection.automation)
  connections: AutomationConnection[];

  @OneToMany(() => require('./automation-execution.entity').AutomationExecution, (execution) => execution.automation)
  executions: AutomationExecution[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
