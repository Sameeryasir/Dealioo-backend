import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Funnel } from './funnel.entity';
import { FunnelPage } from './funnel-page.entity';
import { FunnelPageType } from './funnel-page-type';
import { Business } from './business.entity';
import { User } from './user.entity';

@Entity('funnel_page_versions')
@Index('uq_funnel_page_versions_page_version', ['funnelPageId', 'versionNumber'], {
  unique: true,
})
@Index('IDX_funnel_page_versions_funnel_created', ['funnelId', 'createdAt'])
@Index('IDX_funnel_page_versions_funnel_type_created', [
  'funnelId',
  'pageType',
  'createdAt',
])
@Index('IDX_funnel_page_versions_operation', ['operationId'])
export class FunnelPageVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'funnel_page_id', type: 'uuid' })
  funnelPageId: string;

  @ManyToOne(() => FunnelPage, (page) => page.versions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'funnel_page_id' })
  funnelPage: FunnelPage;

  @Column({ name: 'funnel_id', type: 'int' })
  funnelId: number;

  @ManyToOne(() => Funnel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'funnel_id' })
  funnel: Funnel;

  @Column({
    name: 'page_type',
    type: 'enum',
    enum: FunnelPageType,
    enumName: 'funnel_page_type',
  })
  pageType: FunnelPageType;

  @Column({ name: 'business_id', type: 'int', nullable: true })
  businessId: number | null;

  @ManyToOne(() => Business, { onDelete: 'SET NULL', nullable: true })
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

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
