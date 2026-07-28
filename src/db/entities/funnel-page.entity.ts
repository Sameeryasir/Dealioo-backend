import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Funnel } from './funnel.entity';
import { FunnelPageType } from './funnel-page-type';
import { FunnelPageVersion } from './funnel-page-version.entity';

@Entity('funnel_pages')
@Index('uq_funnel_pages_funnel_type', ['funnelId', 'pageType'], { unique: true })
@Index('IDX_funnel_pages_funnel_id', ['funnelId'])
export class FunnelPage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'funnel_id', type: 'int' })
  funnelId: number;

  @ManyToOne(() => Funnel, (funnel) => funnel.pageRows, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'funnel_id' })
  funnel: Funnel;

  @Column({
    name: 'page_type',
    type: 'enum',
    enum: FunnelPageType,
    enumName: 'funnel_page_type',
  })
  pageType: FunnelPageType;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  schema: Record<string, unknown>;

  @Column({ name: 'current_version', type: 'int', default: 1 })
  currentVersion: number;

  @OneToMany(() => FunnelPageVersion, (version) => version.funnelPage)
  versions: FunnelPageVersion[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
