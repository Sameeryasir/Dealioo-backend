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

@Entity('business_twilio_integrations')
@Index('UQ_business_twilio_integrations_business_id', ['businessId'], {
  unique: true,
})
export class BusinessTwilioIntegration {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'business_id', type: 'int' })
  businessId!: number;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business!: Business;

  @Column({
    name: 'twilio_phone_number',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  twilioPhoneNumber!: string | null;

  @Column({
    name: 'twilio_phone_sid',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  twilioPhoneSid!: string | null;

  @Column({ name: 'twilio_connected_at', type: 'timestamptz', nullable: true })
  twilioConnectedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
