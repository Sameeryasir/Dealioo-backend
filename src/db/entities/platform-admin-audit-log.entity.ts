import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('platform_admin_audit_logs')
export class PlatformAdminAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_user_id', type: 'int' })
  actorUserId: number;

  @Column({ name: 'action', type: 'varchar', length: 64 })
  action: string;

  @Column({ name: 'target_type', type: 'varchar', length: 32 })
  targetType: string;

  @Column({ name: 'target_id', type: 'varchar', length: 64, nullable: true })
  targetId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
