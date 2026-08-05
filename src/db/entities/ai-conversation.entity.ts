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
import type { Business } from './business.entity';
import type { Funnel } from './funnel.entity';
import type { User } from './user.entity';
import type { AiMessage } from './ai-message.entity';
import { AiConversationStatus } from './ai-conversation-status';

@Entity('ai_conversations')
@Index('IDX_ai_conversations_funnel_id', ['funnelId'])
@Index('IDX_ai_conversations_business_id', ['businessId'])
@Index('IDX_ai_conversations_created_by', ['createdById'])
@Index('IDX_ai_conversations_recent', [
  'businessId',
  'funnelId',
  'lastMessageAt',
])
export class AiConversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'business_id', type: 'int' })
  businessId!: number;

  @ManyToOne(() => require('./business.entity').Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business!: Business;

  @Column({ name: 'funnel_id', type: 'int' })
  funnelId!: number;

  @ManyToOne(() => require('./funnel.entity').Funnel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'funnel_id' })
  funnel!: Funnel;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdById!: number | null;

  @ManyToOne(() => require('./user.entity').User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy!: User | null;

  @Column({
    type: 'varchar',
    length: 255,
    default: 'New chat',
  })
  title!: string;

  @Column({
    type: 'enum',
    enum: AiConversationStatus,
    enumName: 'ai_conversation_status',
    default: AiConversationStatus.ACTIVE,
  })
  status!: AiConversationStatus;

  @Column({
    name: 'last_message_at',
    type: 'timestamptz',
    nullable: true,
  })
  lastMessageAt!: Date | null;

  @OneToMany(() => require('./ai-message.entity').AiMessage, (message) => message.conversation)
  messages!: AiMessage[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
