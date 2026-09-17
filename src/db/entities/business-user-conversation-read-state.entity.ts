import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { Business } from './business.entity';
import type { Conversation } from './conversation.entity';
import type { User } from './user.entity';

@Entity('business_user_conversation_read_state')
@Unique('UQ_biz_user_conversation_read', ['userId', 'businessId', 'conversationId'])
@Index('IDX_biz_user_conversation_read_business', ['businessId'])
export class BusinessUserConversationReadState {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id' })
  userId: number;

  @ManyToOne(() => require('./user.entity').User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'business_id' })
  businessId: number;

  @ManyToOne(() => require('./business.entity').Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business: Business;

  @Column({ name: 'conversation_id' })
  conversationId: number;

  @ManyToOne(() => require('./conversation.entity').Conversation, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column({ name: 'last_read_at', type: 'timestamptz' })
  lastReadAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
