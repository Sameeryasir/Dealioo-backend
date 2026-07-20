import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Role } from './role.entity';
import { Otp } from './otp.entity';
import { UserSubscription } from './user-subscription.entity';

/** Auth provider for the user account (LOCAL = email/password). */
export type AuthProvider = 'LOCAL' | 'GOOGLE';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ name: 'first_name', type: 'varchar', nullable: true })
  firstName: string | null;

  @Column({ name: 'last_name', type: 'varchar', nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', unique: true })
  email: string;

  /** Nullable for Google-only accounts that have not added a phone yet. */
  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', nullable: true })
  avatar: string | null;

  @Index('UQ_users_google_id', { unique: true })
  @Column({ name: 'google_id', type: 'varchar', nullable: true, unique: true })
  googleId: string | null;

  @Column({ type: 'varchar', default: 'LOCAL' })
  provider: AuthProvider;

  @Column({ name: 'email_verified', type: 'boolean', default: false })
  emailVerified: boolean;

  @Column({ name: 'phone_verified', type: 'boolean', default: false })
  phoneVerified: boolean;

  /** Nullable for Google-only users (no password set). */
  @Column({ name: 'password_hash', type: 'varchar', nullable: true, select: false })
  passwordHash: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'two_factor_secret', type: 'varchar', nullable: true, select: false })
  twoFactorSecret: string | null;

  @Column({ name: 'two_factor_enabled', type: 'boolean', default: false })
  twoFactorEnabled: boolean;

  @Column({ name: 'is_two_factor_verified', type: 'boolean', default: false })
  isTwoFactorVerified: boolean;

  @Column({ name: 'onboarding_step', type: 'int', default: 0 })
  onboardingStep: number;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @Column({ name: 'stripe_customer_id', type: 'varchar', nullable: true })
  stripeCustomerId: string | null;

  @Column({ name: 'plan_fit_answers', type: 'jsonb', nullable: true })
  planFitAnswers: Record<string, string> | null;

  @Column({ name: 'plan_fit_recommended_plan', type: 'varchar', nullable: true })
  planFitRecommendedPlan: string | null;

  @Column({ name: 'plan_fit_completed_at', type: 'timestamptz', nullable: true })
  planFitCompletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => Role, (role) => role.users, { nullable: false })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @ManyToOne(() => User, (creator) => creator.createdUsers, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'created_by' })
  createdBy: User | null;

  @OneToMany(() => User, (createdUser) => createdUser.createdBy)
  createdUsers: User[];

  @OneToMany(() => Otp, (otp) => otp.user)
  otps: Otp[];

  @OneToMany(() => UserSubscription, (subscription) => subscription.user)
  subscriptions: UserSubscription[];
}
