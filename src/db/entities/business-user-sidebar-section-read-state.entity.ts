import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { Business } from './business.entity';
import type { User } from './user.entity';

export type SidebarUnreadSection = 'orders' | 'activity' | 'history';

@Entity('business_user_sidebar_section_read_state')
@Unique('UQ_sidebar_section_read_user_business_section', [
  'userId',
  'businessId',
  'section',
])
export class BusinessUserSidebarSectionReadState {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id' })
  userId: number;

  @ManyToOne(() => require('./user.entity').User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'business_id' })
  businessId: number;

  @ManyToOne(() => require('./business.entity').Business, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'business_id' })
  business: Business;

  @Column({ name: 'section', type: 'varchar', length: 20 })
  section: SidebarUnreadSection;

  @Column({ name: 'last_viewed_at', type: 'timestamptz' })
  lastViewedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
