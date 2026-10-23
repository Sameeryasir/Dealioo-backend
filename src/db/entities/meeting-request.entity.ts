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

  @Column({
    name: 'business_phone',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  businessPhone: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  currency: string | null;

  @Column({
    name: 'business_email',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  businessEmail: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state: string | null;

  @Column({ name: 'postal_code', type: 'varchar', length: 20, nullable: true })
  postalCode: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country: string | null;

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

  @Column({
    name: 'selected_plan_slug',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  selectedPlanSlug: string | null;

  @Column({
    name: 'selected_plan_name',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  selectedPlanName: string | null;

  @Column({
    name: 'selected_billing_cycle',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  selectedBillingCycle: string | null;

  @Column({
    name: 'scheduled_date',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  scheduledDate: string | null;

  @Column({
    name: 'scheduled_time',
    type: 'varchar',
    length: 5,
    nullable: true,
  })
  scheduledTime: string | null;

  @Column({ name: 'scheduled_duration', type: 'int', nullable: true })
  scheduledDuration: number | null;

  @Column({
    name: 'scheduled_time_zone',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  scheduledTimeZone: string | null;

  @Column({
    name: 'google_event_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  googleEventId: string | null;

  @Column({
    name: 'google_event_link',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  googleEventLink: string | null;

  @Column({
    name: 'google_meet_link',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  googleMeetLink: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  attendance: string | null;

  @Column({
    name: 'sales_outcome',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  salesOutcome: string | null;

  @Column({ name: 'meeting_notes', type: 'text', nullable: true })
  meetingNotes: string | null;

  @Column({ name: 'follow_up_notes', type: 'text', nullable: true })
  followUpNotes: string | null;

  @Column({ name: 'outcome_updated_at', type: 'timestamptz', nullable: true })
  outcomeUpdatedAt: Date | null;

  @Column({ name: 'outcome_updated_by', type: 'int', nullable: true })
  outcomeUpdatedBy: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
