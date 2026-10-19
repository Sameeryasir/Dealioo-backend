import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('google_calendar_connections')
export class GoogleCalendarConnection {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'google_email', type: 'varchar', length: 255 })
  googleEmail: string;

  @Column({ name: 'refresh_token', type: 'text' })
  refreshToken: string;

  @Column({
    name: 'calendar_id',
    type: 'varchar',
    length: 255,
    default: 'primary',
  })
  calendarId: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
