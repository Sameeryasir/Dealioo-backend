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
import { AutomationConnection } from './automation-connection.entity';
import { AutomationExecution } from './automation-execution.entity';
import { AutomationNode } from './automation-node.entity';
import { Campaign } from './campaign.entity';
import { Funnel } from './funnel.entity';
import { Restaurant } from './restaurant.entity';
import { User } from './user.entity';
import { AutomationPurpose } from './automation-purpose.enum';

export enum AutomationTrigger {
  SIGNUP = 'signup',
  PAYMENT = 'payment',
  FUNNEL_COMPLETED = 'funnel_completed',
  ABANDONED_CHECKOUT = 'abandoned_checkout',
  FIRST_PURCHASE = 'first_purchase',
  NO_VISIT = 'no_visit',
}

@Entity('automation')
export class Automation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'restaurant_id' })
  restaurantId: number;

  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id' })
  restaurant: Restaurant;

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

  @ManyToOne(() => Campaign, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign | null;

  @Column({ name: 'funnel_id', nullable: true })
  funnelId: number | null;

  @ManyToOne(() => Funnel, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'funnel_id' })
  funnel: Funnel | null;

  @Column({ name: 'created_by' })
  createdBy: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean;

  @Column({ type: 'boolean', default: false })
  published: boolean;

  @Column({ name: 'is_template', type: 'boolean', default: false })
  isTemplate: boolean;

  @OneToMany(() => AutomationNode, (node) => node.automation)
  nodes: AutomationNode[];

  @OneToMany(() => AutomationConnection, (connection) => connection.automation)
  connections: AutomationConnection[];

  @OneToMany(() => AutomationExecution, (execution) => execution.automation)
  executions: AutomationExecution[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
