import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  BusinessMemberPermission,
  BusinessMemberRole,
} from '../../modules/member/member.constants';
import { Business } from './business.entity';
import { User } from './user.entity';

export enum BusinessInvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

@Entity('business_invitations')
@Index('UQ_business_invitations_token_hash', ['tokenHash'], { unique: true })
@Index('IDX_business_invitations_business_email_status', [
  'business',
  'email',
  'status',
])
export class BusinessInvitation {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Business, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business!: Business;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 32 })
  role!: BusinessMemberRole;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  permissions!: BusinessMemberPermission[];

  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({
    type: 'varchar',
    length: 32,
    default: BusinessInvitationStatus.PENDING,
  })
  status!: BusinessInvitationStatus;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invited_by' })
  invitedBy!: User;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
