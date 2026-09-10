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
import { Business } from './business.entity';

@Entity('business_meta_integrations')
@Index('UQ_business_meta_integrations_business_id', ['businessId'], {
  unique: true,
})
export class BusinessMetaIntegration {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'business_id', type: 'int' })
  businessId!: number;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business!: Business;

  @Column({ name: 'meta_user_id', type: 'varchar', length: 64, nullable: true })
  metaUserId!: string | null;

  @Column({ name: 'meta_access_token', type: 'text', nullable: true })
  metaAccessToken!: string | null;

  @Column({ name: 'meta_connected_at', type: 'timestamptz', nullable: true })
  metaConnectedAt!: Date | null;

  @Column({
    name: 'meta_ad_account_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  metaAdAccountId!: string | null;

  @Column({
    name: 'meta_connection_status',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  metaConnectionStatus!: string | null;

  @Column({
    name: 'meta_token_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  metaTokenExpiresAt!: Date | null;

  @Column({ name: 'meta_oauth_scopes', type: 'text', nullable: true })
  metaOauthScopes!: string | null;

  @Column({ name: 'meta_requested_scopes', type: 'text', nullable: true })
  metaRequestedScopes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
