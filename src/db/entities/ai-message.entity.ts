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

@Entity('ai_messages')
@Index('IDX_ai_messages_conversation_created', ['conversationId', 'createdAt'])
export class AiMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @ManyToOne(() => AiConversation, (conversation) => conversation.messages, {
    onDelete: 'CASCADE',
  })
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
