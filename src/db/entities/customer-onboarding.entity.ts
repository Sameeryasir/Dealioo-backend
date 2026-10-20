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
import type {
  CustomerOnboardingStatus,
  OnboardingTaskKey,
  OnboardingTaskStatus,
} from '../../modules/customer-onboarding/customer-onboarding.constants';
import type { Business } from './business.entity';
import type { MeetingRequest } from './meeting-request.entity';
import type { User } from './user.entity';

@Entity('customer_onboardings')
@Index('IDX_customer_onboardings_status', ['status'])
@Index('IDX_customer_onboardings_updated_at', ['updatedAt'])
@Index('IDX_customer_onboardings_assigned_admin', ['assignedAdminId'])
export class CustomerOnboarding {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'meeting_id', type: 'int' })
  meetingId: number;

  @ManyToOne(() => require('./meeting-request.entity').MeetingRequest, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingRequest;

  @Column({ name: 'user_id', type: 'int', nullable: true })
  userId: number | null;

  @ManyToOne(() => require('./user.entity').User, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ name: 'business_id', type: 'int', nullable: true })
  businessId: number | null;

  @ManyToOne(() => require('./business.entity').Business, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'business_id' })
  business: Business | null;

  @Column({ name: 'assigned_admin_id', type: 'int', nullable: true })
  assignedAdminId: number | null;

  @ManyToOne(() => require('./user.entity').User, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'assigned_admin_id' })
  assignedAdmin: User | null;

  @Column({ type: 'varchar', length: 32 })
  status: CustomerOnboardingStatus;

  @Column({ name: 'selected_plan_id', type: 'int', nullable: true })
  selectedPlanId: number | null;

  @Column({ name: 'customer_name', type: 'varchar', length: 255 })
  customerName: string;

  @Column({ name: 'customer_email', type: 'varchar', length: 255 })
  customerEmail: string;

  @Column({ name: 'customer_phone', type: 'varchar', length: 40, nullable: true })
  customerPhone: string | null;

  @Column({ name: 'business_name', type: 'varchar', length: 512 })
  businessName: string;

  @Column({ name: 'business_category', type: 'varchar', length: 128, nullable: true })
  businessCategory: string | null;

  @Column({ name: 'draft_payload', type: 'jsonb', nullable: true })
  draftPayload: Record<string, unknown> | null;

  @Column({ name: 'internal_notes', type: 'text', nullable: true })
  internalNotes: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'approved_by', type: 'int', nullable: true })
  approvedBy: number | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @OneToMany(() => OnboardingTask, (task) => task.onboarding)
  tasks: OnboardingTask[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('onboarding_tasks')
@Index('UQ_onboarding_tasks_onboarding_key', ['onboardingId', 'taskKey'], {
  unique: true,
})
export class OnboardingTask {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'onboarding_id', type: 'int' })
  onboardingId: number;

  @ManyToOne(() => CustomerOnboarding, (onboarding) => onboarding.tasks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'onboarding_id' })
  onboarding: CustomerOnboarding;

  @Column({ name: 'task_key', type: 'varchar', length: 64 })
  taskKey: OnboardingTaskKey;

  @Column({ type: 'varchar', length: 32 })
  status: OnboardingTaskStatus;

  @Column({ name: 'completed_by', type: 'int', nullable: true })
  completedBy: number | null;

  @ManyToOne(() => require('./user.entity').User, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'completed_by' })
  completedByUser: User | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
