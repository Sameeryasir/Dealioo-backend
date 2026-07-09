import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Logs Meta API failures per creation step for debugging and user messaging. */
@Entity('meta_campaign_errors')
export class MetaCampaignError {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({ name: 'restaurant_id', type: 'int' })
  businessId: number;

  @Column({ name: 'facebook_campaign_id', type: 'uuid', nullable: true })
  facebookCampaignId: string | null;

  @Column({ type: 'varchar', length: 32 })
  step: string;

  @Column({ name: 'meta_error_code', type: 'int', nullable: true })
  metaErrorCode: number | null;

  @Column({ name: 'meta_error_message', type: 'text' })
  metaErrorMessage: string;

  @Column({ name: 'raw_response', type: 'text', nullable: true })
  rawResponse: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
