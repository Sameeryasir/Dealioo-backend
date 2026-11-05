import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ScannerRedemptionRequestStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity('scanner_redemption_requests')
@Index(
  'UQ_scanner_redemption_business_idempotency',
  ['businessId', 'idempotencyKey'],
  { unique: true },
)
export class ScannerRedemptionRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'business_id', type: 'int' })
  businessId: number;

  @Column({ name: 'staff_user_id', type: 'int', nullable: true })
  staffUserId: number | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash: string;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 32,
    default: ScannerRedemptionRequestStatus.IN_PROGRESS,
  })
  status: ScannerRedemptionRequestStatus;

  @Column({ name: 'response_json', type: 'jsonb', nullable: true })
  responseJson: unknown | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
