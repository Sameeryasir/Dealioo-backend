import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScannerRedemptionRequestsTable1786579200155
  implements MigrationInterface
{
  name = 'CreateScannerRedemptionRequestsTable1786579200155';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('scanner_redemption_requests');
    if (!hasTable) {
      await queryRunner.query(
        `CREATE TABLE "scanner_redemption_requests" (
          "id" SERIAL NOT NULL,
          "business_id" integer NOT NULL,
          "staff_user_id" integer,
          "idempotency_key" character varying(128) NOT NULL,
          "request_hash" character varying(64) NOT NULL,
          "status" character varying(32) NOT NULL DEFAULT 'IN_PROGRESS',
          "response_json" jsonb,
          "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_scanner_redemption_requests" PRIMARY KEY ("id")
        )`,
      );
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_scanner_redemption_business_idempotency"
       ON "scanner_redemption_requests" ("business_id", "idempotency_key")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_scanner_redemption_business_idempotency"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "scanner_redemption_requests" CASCADE`,
    );
  }
}
