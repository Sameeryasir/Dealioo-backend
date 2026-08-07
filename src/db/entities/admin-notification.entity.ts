import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AdminNotificationType =
  | 'user'
  | 'business'
  | 'subscription'
  | 'payment'
  | 'campaign'
  | 'system';

export type AdminNotificationSeverity =
  | 'info'
  | 'success'
  | 'warning'
  | 'error';

export type AdminNotificationSource =
  | 'system'
  | 'stripe'
  | 'meta'
  | 'google'
  | 'scheduler'
  | 'user';

@Entity('admin_notifications')
@Index('IDX_admin_notifications_created', ['createdAt'])
@Index('IDX_admin_notifications_unread', ['isRead', 'createdAt'])
@Index('IDX_admin_notifications_type', ['type', 'createdAt'])
@Index('IDX_admin_notifications_severity', ['severity', 'createdAt'])
@Index('IDX_admin_notifications_resource', ['resourceType', 'resourceId'])
@Index('UQ_admin_notifications_idempotency_key', ['idempotencyKey'], {
  unique: true,
})
export class AdminNotification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'varchar',
    length: 32,
  })
  type!: AdminNotificationType;

  @Column({
    name: 'event_key',
    type: 'varchar',
    length: 100,
  })
  eventKey!: string;

  @Column({
    type: 'varchar',
    length: 255,
  })
  title!: string;

  @Column({
    type: 'text',
  })
  body!: string;

  @Column({
    type: 'varchar',
    length: 16,
    default: 'info',
  })
  severity!: AdminNotificationSeverity;

  @Column({
    name: 'action_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  actionUrl!: string | null;

  @Column({
    name: 'resource_type',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  resourceType!: string | null;

  @Column({
    name: 'resource_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  resourceId!: string | null;

  @Column({
    name: 'actor_user_id',
    type: 'int',
    nullable: true,
  })
  actorUserId!: number | null;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 191,
  })
  idempotencyKey!: string;

  @Column({
    type: 'jsonb',
    nullable: true,
  })
  metadata!: Record<string, unknown> | null;

  @Column({
    name: 'is_read',
    type: 'boolean',
    default: false,
  })
  isRead!: boolean;

  @Column({
    name: 'read_at',
    type: 'timestamptz',
    nullable: true,
  })
  readAt!: Date | null;

  @Column({
    name: 'is_archived',
    type: 'boolean',
    default: false,
  })
  isArchived!: boolean;

  @Column({
    type: 'varchar',
    length: 32,
    default: 'system',
  })
  source!: AdminNotificationSource;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  createdAt!: Date;
}
