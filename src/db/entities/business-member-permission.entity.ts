import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { BusinessMemberPermission as BusinessMemberPermissionKey } from '../../modules/member/member.constants';
import { BusinessMember } from './business-member.entity';

@Entity('business_member_permissions')
@Index(
  'UQ_business_member_permissions_member_permission',
  ['businessMember', 'permission'],
  { unique: true },
)
@Index('IDX_business_member_permissions_member_id', ['businessMember'])
export class BusinessMemberPermission {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => BusinessMember, (member) => member.permissionRows, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'business_member_id' })
  businessMember!: BusinessMember;

  @Column({ type: 'varchar', length: 64 })
  permission!: BusinessMemberPermissionKey;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
