import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Business } from './business.entity';
export enum MetaOAuthSessionStatus {
  INITIATED = 'INITIATED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity('meta_oauth_sessions')
export class MetaOAuthSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('IDX_meta_oauth_sessions_business_id')
  @Column({ name: 'business_id', type: 'int' })
  businessId: number;

  @ManyToOne(() => require('./business.entity').Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business: Business;

  @Column({ name: 'requested_scopes', type: 'jsonb' })
  requestedScopes: string[];

  @Index('IDX_meta_oauth_sessions_oauth_state', { unique: true })
  @Column({ name: 'oauth_state', type: 'varchar', length: 255 })
  oauthState: string;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 32,
    default: MetaOAuthSessionStatus.INITIATED,
  })
  status: MetaOAuthSessionStatus | string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
