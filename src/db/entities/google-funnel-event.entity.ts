import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  GoogleFunnelEventName,
  GoogleFunnelEventStatus,
} from './google-funnel-event-status';

@Entity('google_funnel_events')
@Index('UQ_google_funnel_events_event_id', ['eventId'], { unique: true })
@Index('IDX_google_funnel_events_business_created', ['businessId', 'createdAt'])
@Index('IDX_google_funnel_events_funnel_created', ['funnelId', 'createdAt'])
@Index('IDX_google_funnel_events_status_created', ['status', 'createdAt'])
export class GoogleFunnelEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_id', type: 'varchar', length: 64 })
  eventId!: string;

  @Column({ name: 'event_name', type: 'varchar', length: 64 })
  eventName!: GoogleFunnelEventName | string;

  @Column({ name: 'business_id', type: 'int' })
  businessId!: number;

  @Column({ name: 'funnel_id', type: 'int', nullable: true })
  funnelId!: number | null;

  @Column({ name: 'google_ads_id', type: 'varchar', length: 64 })
  googleAdsId!: string;

  @Column({
    name: 'conversion_label',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  conversionLabel!: string | null;

  @Column({ name: 'send_to', type: 'varchar', length: 191, nullable: true })
  sendTo!: string | null;

  @Column({
    type: 'varchar',
    length: 32,
    default: GoogleFunnelEventStatus.STORED,
  })
  status!: GoogleFunnelEventStatus;

  @Column({ name: 'event_time', type: 'bigint' })
  eventTime!: string;

  @Column({ name: 'event_source_url', type: 'text', nullable: true })
  eventSourceUrl!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  value!: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  currency!: string | null;

  @Column({
    name: 'transaction_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  transactionId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  gclid!: string | null;

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
