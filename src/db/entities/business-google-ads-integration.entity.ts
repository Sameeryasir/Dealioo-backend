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

@Entity('business_google_ads_integrations')
@Index('UQ_business_google_ads_integrations_business_id', ['businessId'], {
  unique: true,
})
export class BusinessGoogleAdsIntegration {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'business_id', type: 'int' })
  businessId!: number;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business!: Business;

  @Column({
    name: 'google_user_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  googleUserId!: string | null;

  @Column({ name: 'google_refresh_token', type: 'text', nullable: true })
  googleRefreshToken!: string | null;

  @Column({ name: 'google_access_token', type: 'text', nullable: true })
  googleAccessToken!: string | null;

  @Column({ name: 'google_connected_at', type: 'timestamptz', nullable: true })
  googleConnectedAt!: Date | null;

  @Column({
    name: 'google_customer_id',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  googleCustomerId!: string | null;

  @Column({
    name: 'google_login_customer_id',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  googleLoginCustomerId!: string | null;

  @Column({
    name: 'google_connection_status',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  googleConnectionStatus!: string | null;

  @Column({
    name: 'google_token_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  googleTokenExpiresAt!: Date | null;

  @Column({ name: 'google_oauth_scopes', type: 'text', nullable: true })
  googleOauthScopes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
