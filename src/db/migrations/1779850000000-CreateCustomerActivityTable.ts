import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerActivityTable1779850000000
  implements MigrationInterface
{
  name = 'CreateCustomerActivityTable1779850000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_activity" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "business_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "activity_type" character varying(32) NOT NULL,
        "source" character varying(32) NOT NULL,
        "reference_type" character varying(32) NULL,
        "reference_id" character varying(64) NULL,
        "amount" integer NULL,
        "currency" character varying(10) NULL,
        "metadata" jsonb NULL,
        "idempotency_key" character varying(180) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_activity" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_customer_activity_idempotency" UNIQUE ("idempotency_key"),
        CONSTRAINT "FK_customer_activity_business"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_customer_activity_customer"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_activity_business_customer_created"
      ON "customer_activity" ("business_id", "customer_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_activity_type_ref"
      ON "customer_activity" ("activity_type", "reference_type", "reference_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_customer_activity_type_ref"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_customer_activity_business_customer_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_activity"`);
  }
}
