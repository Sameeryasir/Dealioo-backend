import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('google_wallet_events')
@Index('google_wallet_event_nonce_unique', ['nonce'], {
  unique: true,
  where: '"nonce" IS NOT NULL',
})
export class GoogleWalletEvent {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'object_id', type: 'varchar', length: 255 })
  objectId!: string;

  @Column({ name: 'coupon_id', type: 'int', nullable: true })
  couponId!: number | null;

  @Column({ name: 'event_type', type: 'varchar', length: 32, nullable: true })
  eventType!: string | null;

  @Column({ name: 'nonce', type: 'varchar', length: 255, nullable: true })
  nonce!: string | null;

  @Column({ name: 'raw_payload', type: 'text', nullable: true })
  rawPayload!: string | null;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;
}
