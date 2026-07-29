import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AiConversation } from './ai-conversation.entity';
import { AiMessageRole } from './ai-message-role';
import { AiMessagePage } from './ai-message-page';
import { AiMessageStatus } from './ai-message-status';

@Entity('ai_messages')
@Index('IDX_ai_messages_conversation_created', [
  'conversationId',
  'createdAt',
])
@Index('IDX_ai_messages_job_id', ['jobId'])
export class AiMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @ManyToOne(
    () => AiConversation,
    (conversation) => conversation.messages,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'conversation_id' })
  conversation!: AiConversation;

  @Column({
    type: 'enum',
    enum: AiMessageRole,
    enumName: 'ai_message_role',
  })
  role!: AiMessageRole;

  @Column({ type: 'text' })
  content!: string;

  @Column({
    name: 'page_id',
    type: 'enum',
    enum: AiMessagePage,
    enumName: 'ai_message_page',
    nullable: true,
  })
  pageId!: AiMessagePage | null;

  @Column({
    type: 'enum',
    enum: AiMessageStatus,
    enumName: 'ai_message_status',
    default: AiMessageStatus.COMPLETED,
  })
  status!: AiMessageStatus;

  @Column({
    name: 'job_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  jobId!: string | null;

  @Column({
    name: 'schema_patch',
    type: 'jsonb',
    nullable: true,
  })
  schemaPatch!: Record<string, unknown> | null;

  @Column({
    name: 'error_message',
    type: 'text',
    nullable: true,
  })
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
