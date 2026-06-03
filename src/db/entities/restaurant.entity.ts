import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Menu } from './menu.entity';
import { Campaign } from './campaign.entity';

@Entity('restaurants')
export class Restaurant {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'cuisine_type', type: 'varchar', nullable: true })
  cuisineType: string | null;

  @Column({ name: 'logo_url', type: 'text', nullable: true })
  logoUrl: string | null;

  @Column({ name: 'website_url', type: 'varchar', length: 2048, nullable: true })
  websiteUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ name: 'phone_number', type: 'varchar', nullable: true })
  phoneNumber: string | null;

  @Column({ type: 'varchar', nullable: true })
  city: string | null;

  @Column({ type: 'varchar', nullable: true })
  state: string | null;

  @Column({ type: 'varchar', nullable: true })
  country: string | null;

  @Column({ name: 'postal_code', type: 'varchar', nullable: true })
  postalCode: string | null;

  @Column({ name: 'branch_count', type: 'int', default: 0 })
  branchCount: number;

  @Column({
    name: 'stripe_account_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeAccountId: string | null;

  @Column({ name: 'meta_user_id', type: 'varchar', length: 64, nullable: true })
  metaUserId: string | null;

  @Column({ name: 'meta_access_token', type: 'text', nullable: true })
  metaAccessToken: string | null;

  @Column({ name: 'meta_connected_at', type: 'timestamptz', nullable: true })
  metaConnectedAt: Date | null;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @OneToMany(() => Menu, (m) => m.restaurant)
  menu: Menu[];

  @OneToMany(() => Campaign, (campaign) => campaign.restaurant)
  campaigns: Campaign[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
