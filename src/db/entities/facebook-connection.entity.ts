import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { FacebookPage } from './facebook-page.entity';

@Entity('facebook_connections')
export class FacebookConnection {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', type: 'int', unique: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'facebook_access_token', type: 'text' })
  facebookAccessToken: string;

  @Column({ name: 'facebook_user_id', type: 'varchar', length: 64 })
  facebookUserId: string;

  @Column({
    name: 'facebook_user_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  facebookUserName: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiry: Date | null;

  @Column({ name: 'connected_at', type: 'timestamptz' })
  connectedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => FacebookPage, (page) => page.connection)
  pages: FacebookPage[];
}
