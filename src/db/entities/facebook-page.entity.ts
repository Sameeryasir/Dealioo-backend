import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FacebookConnection } from './facebook-connection.entity';

@Entity('facebook_pages')
export class FacebookPage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({ name: 'connection_id', type: 'int' })
  connectionId: number;

  @ManyToOne(() => FacebookConnection, (connection) => connection.pages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'connection_id' })
  connection: FacebookConnection;

  @Column({ name: 'page_id', type: 'varchar', length: 64 })
  pageId: string;

  @Column({ name: 'page_name', type: 'varchar', length: 255 })
  pageName: string;

  @Column({ name: 'page_access_token', type: 'text' })
  pageAccessToken: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
