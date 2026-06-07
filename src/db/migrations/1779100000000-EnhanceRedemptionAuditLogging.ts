import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds audit fields for production QR redemption:
 * - event_type: preview/redeem success/failure
 * - ip_address: request origin for fraud review
 * - idempotency_key: prevents duplicate redemptions on network retry
 */
export class EnhanceRedemptionAuditLogging1779100000000
  implements MigrationInterface
{
  name = 'EnhanceRedemptionAuditLogging1779100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "redemption_logs"
      ADD COLUMN "event_type" character varying(32),
      ADD COLUMN "ip_address" character varying(64),
      ADD COLUMN "idempotency_key" character varying(128)
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_redemption_logs_idempotency_key"
      ON "redemption_logs" ("idempotency_key")
      WHERE "idempotency_key" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_redemption_logs_idempotency_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "redemption_logs"
      DROP COLUMN IF EXISTS "idempotency_key",
      DROP COLUMN IF EXISTS "ip_address",
      DROP COLUMN IF EXISTS "event_type"
    `);
  }
}
