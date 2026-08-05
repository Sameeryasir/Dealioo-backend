import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  MetaProductEventName,
  MetaProductEventStatus,
} from './meta-product-event-status';

@Entity('meta_product_events')
@Index('UQ_meta_product_events_event_id', ['eventId'], { unique: true })
@Index('IDX_meta_product_events_status_created', ['status', 'createdAt'])
@Index('IDX_meta_product_events_event_name_created', ['eventName', 'createdAt'])
export class MetaProductEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_id', type: 'varchar', length: 64 })
  eventId!: string;

  @Column({ name: 'event_name', type: 'varchar', length: 64 })
  eventName!: MetaProductEventName | string;

  @Column({ name: 'pixel_id', type: 'varchar', length: 64 })
  pixelId!: string;

  @Column({ type: 'varchar', length: 32, default: 'dealioo' })
  product!: string;

  @Column({ type: 'varchar', length: 32, default: MetaProductEventStatus.PENDING })
  status!: MetaProductEventStatus;

  @Column({ name: 'event_time', type: 'bigint' })
  eventTime!: string;

  @Column({ name: 'event_source_url', type: 'text', nullable: true })
  eventSourceUrl!: string | null;

  @Column({ name: 'action_source', type: 'varchar', length: 32, default: 'website' })
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

  @Column({ type: 'jsonb', nullable: true })
  payload!: object | null;

  @Column({ name: 'meta_response', type: 'jsonb', nullable: true })
  metaResponse!: object | null;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
