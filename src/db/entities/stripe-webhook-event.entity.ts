import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('stripe_webhook_event')
export class StripeWebhookEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'stripe_event_id', type: 'varchar', length: 255, unique: true })
  stripeEventId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 128 })
  eventType: string;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
