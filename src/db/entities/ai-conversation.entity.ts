import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Business } from './business.entity';
import { Funnel } from './funnel.entity';
import { User } from './user.entity';
import { AiMessage } from './ai-message.entity';

@Entity('ai_conversations')
@Index('uq_ai_conversations_funnel_id', ['funnelId'], { unique: true })
@Index('IDX_ai_conversations_business_id', ['businessId'])
@Index('IDX_ai_conversations_created_by', ['createdById'])
export class AiConversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'business_id', type: 'int' })
  businessId!: number;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business!: Business;

  @Column({ name: 'funnel_id', type: 'int' })
  funnelId!: number;

  @ManyToOne(() => Funnel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'funnel_id' })
  funnel!: Funnel;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdById!: number | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy!: User | null;

  @OneToMany(() => AiMessage, (message) => message.conversation)
  messages!: AiMessage[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
