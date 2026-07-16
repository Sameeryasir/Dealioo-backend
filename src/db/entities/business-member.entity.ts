import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type {
  BusinessMemberPermission as BusinessMemberPermissionKey,
  BusinessMemberRole,
} from '../../modules/member/member.constants';
import { Business } from './business.entity';
import { BusinessMemberPermission } from './business-member-permission.entity';
import { Role } from './role.entity';
import { User } from './user.entity';

@Entity('business_members')
@Unique('UQ_business_members_business_user', ['business', 'user'])
export class BusinessMember {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Business, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business!: Business;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 32 })
  role!: BusinessMemberRole;

  @ManyToOne(() => Role, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'role_id' })
  memberRole!: Role | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  permissions!: BusinessMemberPermissionKey[];

  @OneToMany(
    () => BusinessMemberPermission,
    (permissionRow) => permissionRow.businessMember,
  )
  permissionRows!: BusinessMemberPermission[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
