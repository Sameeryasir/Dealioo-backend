import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('scanner_purchase_requests')
@Index('UQ_scanner_purchase_business_idempotency', ['businessId', 'idempotencyKey'], {
  unique: true,
})
export class ScannerPurchaseRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'business_id', type: 'int' })
  businessId: number;

  @Column({ name: 'customer_id', type: 'int' })
  customerId: number;

  @Column({ name: 'staff_user_id', type: 'int' })
  staffUserId: number;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash: string;

  @Column({ name: 'response_json', type: 'jsonb' })
  responseJson: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
