import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Funnel } from './funnel.entity';
import type { Business } from './business.entity';
import type { User } from './user.entity';
@Entity('funnel_versions')
@Index('IDX_funnel_versions_funnel_version', ['funnelId', 'versionNumber'], {
  unique: true,
})
@Index('IDX_funnel_versions_funnel_created', ['funnelId', 'createdAt'])
export class FunnelVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'funnel_id', type: 'int' })
  funnelId: number;

  @ManyToOne(() => require('./funnel.entity').Funnel, (funnel) => funnel.versions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'funnel_id' })
  funnel: Funnel;

  @Column({ name: 'business_id', type: 'int', nullable: true })
  businessId: number | null;

  @ManyToOne(() => require('./business.entity').Business, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'business_id' })
  business: Business | null;

  @Column({ name: 'version_number', type: 'int' })
  versionNumber: number;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  schema: Record<string, unknown>;

  @Column({ name: 'operation_id', type: 'varchar', length: 64, nullable: true })
  operationId: string | null;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdById: number | null;

  @ManyToOne(() => require('./user.entity').User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
