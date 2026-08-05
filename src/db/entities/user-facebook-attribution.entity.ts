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
import type { User } from './user.entity';
@Entity('user_facebook_attributions')
@Index('UQ_user_facebook_attributions_user_id', ['userId'], { unique: true })
export class UserFacebookAttribution {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @ManyToOne(() => require('./user.entity').User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fbclid!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fbc!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fbp!: string | null;

  @Column({ name: 'captured_at', type: 'timestamptz' })
  capturedAt!: Date;

  @Column({ type: 'varchar', length: 64, default: 'anonymous_browser_claim' })
  source!: string;

  @Column({ name: 'landing_url', type: 'text', nullable: true })
  landingUrl!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
