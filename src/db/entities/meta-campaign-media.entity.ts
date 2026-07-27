import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('meta_campaign_media')
export class MetaCampaignMedia {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'draft_id', type: 'uuid', nullable: true })
  draftId: string | null;

  @Column({ name: 'business_id', type: 'int' })
  businessId: number;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({ name: 'media_type', type: 'varchar', length: 16 })
  mediaType: string;

  @Column({ type: 'varchar', length: 512 })
  filename: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 128 })
  mimeType: string;

  @Column({ name: 'size_bytes', type: 'bigint', default: 0 })
  sizeBytes: string;

  @Column({ name: 'storage_key', type: 'varchar', length: 1024, nullable: true })
  storageKey: string | null;

  @Column({ name: 'storage_url', type: 'varchar', length: 2048, nullable: true })
  storageUrl: string | null;

  @Column({
    name: 'upload_status',
    type: 'varchar',
    length: 32,
    default: 'uploading',
  })
  uploadStatus: string;

  @Column({
    name: 'meta_image_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  metaImageHash: string | null;

  @Column({ name: 'meta_video_id', type: 'varchar', length: 64, nullable: true })
  metaVideoId: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
