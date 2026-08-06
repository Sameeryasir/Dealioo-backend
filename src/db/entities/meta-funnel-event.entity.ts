import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  MetaFunnelEventName,
  MetaFunnelEventStatus,
} from './meta-funnel-event-status';

@Entity('meta_funnel_events')
@Index('UQ_meta_funnel_events_event_id', ['eventId'], { unique: true })
@Index('IDX_meta_funnel_events_business_created', ['businessId', 'createdAt'])
@Index('IDX_meta_funnel_events_funnel_created', ['funnelId', 'createdAt'])
@Index('IDX_meta_funnel_events_status_created', ['status', 'createdAt'])
export class MetaFunnelEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_id', type: 'varchar', length: 64 })
  eventId!: string;

  @Column({ name: 'event_name', type: 'varchar', length: 64 })
  eventName!: MetaFunnelEventName | string;

  @Column({ name: 'business_id', type: 'int' })
  businessId!: number;

  @Column({ name: 'funnel_id', type: 'int', nullable: true })
  funnelId!: number | null;

  @Column({ name: 'pixel_id', type: 'varchar', length: 64 })
  pixelId!: string;

  @Column({
    type: 'varchar',
    length: 32,
    default: MetaFunnelEventStatus.STORED,
  })
  status!: MetaFunnelEventStatus;

  @Column({ name: 'event_time', type: 'bigint' })
  eventTime!: string;

  @Column({ name: 'event_source_url', type: 'text', nullable: true })
  eventSourceUrl!: string | null;

  @Column({
    name: 'action_source',
    type: 'varchar',
    length: 32,
    default: 'website',
  })
  actionSource!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fbp!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fbc!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fbclid!: string | null;

  @Column({ name: 'user_data', type: 'jsonb', nullable: true })
  userData!: object | null;

  @Column({ name: 'custom_data', type: 'jsonb', nullable: true })
  customData!: object | null;

  @Column({ name: 'client_ip', type: 'varchar', length: 64, nullable: true })
  clientIp!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
