import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Customer } from './customer.entity';
import { Funnel } from './funnel.entity';

export enum FunnelAnalyticsEventType {
  PAGE_VIEW = 'page_view',
  BUTTON_CLICK = 'button_click',
  SCROLL = 'scroll',
  FORM_START = 'form_start',
  CHECKOUT_OPEN = 'checkout_open',
  VIDEO_PLAY = 'video_play',
  EXIT_INTENT = 'exit_intent',
}

@Entity('funnel_analytics_event')
@Index('IDX_funnel_analytics_funnel_created', ['funnelId', 'createdAt'])
@Index('IDX_funnel_analytics_funnel_event_type', ['funnelId', 'eventType'])
export class FunnelAnalyticsEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'funnel_id' })
  funnelId: number;

  @ManyToOne(() => Funnel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'funnel_id' })
  funnel: Funnel;

  @Column({ name: 'visitor_id', type: 'varchar', length: 64, nullable: true })
  visitorId: string | null;

  @Column({ name: 'customer_id', nullable: true })
  customerId: number | null;

  @ManyToOne(() => Customer, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer | null;

  @Column({ name: 'session_id', type: 'varchar', length: 64, nullable: true })
  sessionId: string | null;

  @Column({
    name: 'event_type',
    type: 'enum',
    enum: FunnelAnalyticsEventType,
  })
  eventType: FunnelAnalyticsEventType;

  @Column({ name: 'page_path', type: 'varchar', length: 512, nullable: true })
  pagePath: string | null;

  @Column({ name: 'step_name', type: 'varchar', length: 64, nullable: true })
  stepName: string | null;

  @Column({ name: 'step_order', type: 'int', nullable: true })
  stepOrder: number | null;

  @Column({ name: 'utm_source', type: 'varchar', length: 255, nullable: true })
  utmSource: string | null;

  @Column({ name: 'utm_medium', type: 'varchar', length: 255, nullable: true })
  utmMedium: string | null;

  @Column({ name: 'utm_campaign', type: 'varchar', length: 255, nullable: true })
  utmCampaign: string | null;

  @Column({ name: 'referrer', type: 'varchar', length: 512, nullable: true })
  referrer: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
