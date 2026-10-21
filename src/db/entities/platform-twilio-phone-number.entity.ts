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

@Entity('platform_twilio_phone_numbers')
@Index('UQ_platform_twilio_phone_numbers_sid', ['phoneSid'], { unique: true })
@Index('UQ_platform_twilio_phone_numbers_number', ['phoneNumber'], {
  unique: true,
})
@Index('IDX_platform_twilio_phone_numbers_business', ['businessId'])
export class PlatformTwilioPhoneNumber {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'phone_sid', type: 'varchar', length: 64 })
  phoneSid!: string;

  @Column({ name: 'phone_number', type: 'varchar', length: 32 })
  phoneNumber!: string;

  @Column({
    name: 'friendly_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  friendlyName!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  status!: string | null;

  @Column({
    name: 'address_requirement',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  addressRequirement!: string | null;

  @Column({ name: 'date_created', type: 'timestamptz', nullable: true })
  dateCreated!: Date | null;

  @Column({ name: 'webhook_url', type: 'text', nullable: true })
  webhookUrl!: string | null;

  @Column({ name: 'webhook_configured', type: 'boolean', default: false })
  webhookConfigured!: boolean;

  @Column({ name: 'cap_sms', type: 'boolean', default: false })
  capSms!: boolean;

  @Column({ name: 'cap_mms', type: 'boolean', default: false })
  capMms!: boolean;

  @Column({ name: 'cap_voice', type: 'boolean', default: false })
  capVoice!: boolean;

  @Column({ name: 'cap_fax', type: 'boolean', default: false })
  capFax!: boolean;

  @Column({ name: 'business_id', type: 'int', nullable: true })
  businessId!: number | null;

  @ManyToOne(() => require('./business.entity').Business, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'business_id' })
  business!: Business | null;

  @Column({ name: 'connected_at', type: 'timestamptz', nullable: true })
  connectedAt!: Date | null;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
