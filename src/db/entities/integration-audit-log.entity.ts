import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('integration_audit_logs')
export class IntegrationAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'restaurant_id', type: 'int' })
  restaurantId: number;

  @Column({ type: 'varchar', length: 64, default: 'facebook' })
  provider: string;

  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  eventType: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  status: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
