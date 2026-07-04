import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
@Entity('meeting_request')
@Index('IDX_meeting_request_created_at', ['createdAt'])
@Index('IDX_meeting_request_email', ['email'])
export class MeetingRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'first_name', type: 'varchar', length: 120 })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', length: 120 })
  lastName: string;

  @Column({ type: 'varchar', length: 40 })
  phone: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ name: 'business_role', type: 'varchar', length: 64 })
  businessRole: string;

  @Column({ name: 'business_category', type: 'varchar', length: 128 })
  businessCategory: string;

  @Column({ name: 'business_name', type: 'varchar', length: 512 })
  businessName: string;

  @Column({ name: 'city_location', type: 'varchar', length: 255 })
  cityLocation: string;

  @Column({ name: 'monthly_revenue', type: 'varchar', length: 32 })
  monthlyRevenue: string;

  @Column({ name: 'marketing_activities', type: 'jsonb' })
  marketingActivities: string[];

  @Column({ name: 'current_situation', type: 'text' })
  currentSituation: string;

  @Column({ name: 'start_timeline', type: 'varchar', length: 64 })
  startTimeline: string;

  @Column({ name: 'meeting_commitment', type: 'varchar', length: 64 })
  meetingCommitment: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
