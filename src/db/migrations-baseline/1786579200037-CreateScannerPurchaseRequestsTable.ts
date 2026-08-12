import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScannerPurchaseRequestsTable1786579200037 implements MigrationInterface {
  name = 'CreateScannerPurchaseRequestsTable1786579200037';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('scanner_purchase_requests');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "scanner_purchase_requests" ("id" SERIAL NOT NULL, "business_id" integer NOT NULL, "customer_id" integer NOT NULL, "staff_user_id" integer NOT NULL, "idempotency_key" character varying(128) NOT NULL, "request_hash" character varying(64) NOT NULL, "response_json" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a77aedfc4e930beff78dc53335b" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_scanner_purchase_business_idempotency" ON "scanner_purchase_requests" ("business_id", "idempotency_key") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "scanner_purchase_requests" CASCADE`);
  }
}
