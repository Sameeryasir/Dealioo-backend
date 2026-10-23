import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('meeting_email_challenges')
export class MeetingEmailChallenge {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 16 })
  code: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'is_used', type: 'boolean', default: false })
  isUsed: boolean;

  @Index({ unique: true })
  @Column({
    name: 'proof_token_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  proofTokenHash: string | null;

  @Column({ name: 'proof_expires_at', type: 'timestamptz', nullable: true })
  proofExpiresAt: Date | null;

  @Column({ name: 'proof_used_at', type: 'timestamptz', nullable: true })
  proofUsedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
