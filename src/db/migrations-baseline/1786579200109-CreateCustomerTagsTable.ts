import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerTagsTable1786579200109
  implements MigrationInterface
{
  name = 'CreateCustomerTagsTable1786579200109';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_tags" (
        "id" SERIAL PRIMARY KEY,
        "business_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "tag" character varying(64) NOT NULL,
        "source" character varying(64) NULL,
        "created_by_user_id" integer NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_customer_tags_business_customer_tag"
          UNIQUE ("business_id", "customer_id", "tag"),
        CONSTRAINT "FK_customer_tags_business"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_customer_tags_customer"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_tags_business_tag"
      ON "customer_tags" ("business_id", "tag")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_tags_customer"
      ON "customer_tags" ("customer_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_customer_tags_customer"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_customer_tags_business_tag"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_tags"`);
  }
}
