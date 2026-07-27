import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('meta_publish_attempts')
export class MetaPublishAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'draft_id', type: 'uuid' })
  draftId: string;

  @Column({ name: 'business_id', type: 'int' })
  businessId: number;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({ name: 'job_id', type: 'varchar', length: 128, nullable: true })
  jobId: string | null;

  @Column({ type: 'varchar', length: 64 })
  step: string;

  @Column({ type: 'varchar', length: 32 })
  status: string;

  @Column({ name: 'meta_id', type: 'varchar', length: 64, nullable: true })
  metaId: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
