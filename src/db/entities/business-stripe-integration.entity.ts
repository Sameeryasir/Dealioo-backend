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

@Entity('business_stripe_integrations')
@Index('UQ_business_stripe_integrations_business_id', ['businessId'], {
  unique: true,
})
export class BusinessStripeIntegration {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'business_id', type: 'int' })
  businessId!: number;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business!: Business;

  @Column({
    name: 'stripe_account_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeAccountId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
