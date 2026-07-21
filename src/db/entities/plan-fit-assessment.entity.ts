import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('plan_fit_assessments')
export class PlanFitAssessment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index('IDX_plan_fit_assessments_user_id')
  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 32 })
  version!: string;

  @Column({ type: 'jsonb' })
  answers!: Record<string, string>;

  @Column({ type: 'jsonb' })
  scores!: Record<string, number>;

  @Column({ name: 'recommended_plan_slug', type: 'varchar', length: 64 })
  recommendedPlanSlug!: string;

  @Column({ type: 'varchar', length: 16 })
  confidence!: string;

  @Column({ name: 'selected_plan_slug', type: 'varchar', length: 64, nullable: true })
  selectedPlanSlug!: string | null;

  @Column({ name: 'recommendation_accepted', type: 'boolean', nullable: true })
  recommendationAccepted!: boolean | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
