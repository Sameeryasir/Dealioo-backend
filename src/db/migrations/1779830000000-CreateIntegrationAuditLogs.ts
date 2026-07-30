import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIntegrationAuditLogs1779830000000
  implements MigrationInterface
{
  name = 'CreateIntegrationAuditLogs1779830000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "integration_audit_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "business_id" integer NOT NULL,
        "provider" character varying(64) NOT NULL DEFAULT 'facebook',
        "event_type" character varying(64) NOT NULL,
        "status" character varying(32),
        "metadata" jsonb,
        "error_message" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_audit_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_integration_audit_logs_business_id"
      ON "integration_audit_logs" ("business_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_integration_audit_logs_business_created"
      ON "integration_audit_logs" ("business_id", "created_at" DESC)
    `);

    if (await queryRunner.hasTable('businesses')) {
      await queryRunner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'FK_integration_audit_logs_business'
          ) THEN
            ALTER TABLE "integration_audit_logs"
            ADD CONSTRAINT "FK_integration_audit_logs_business"
            FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
            ON DELETE CASCADE;
          END IF;
        END $$;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integration_audit_logs"
      DROP CONSTRAINT IF EXISTS "FK_integration_audit_logs_business"
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_integration_audit_logs_business_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_integration_audit_logs_business_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "integration_audit_logs"`);
  }
}
