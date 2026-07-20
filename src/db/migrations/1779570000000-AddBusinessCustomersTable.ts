import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessCustomersTable1779570000000
  implements MigrationInterface
{
  name = 'AddBusinessCustomersTable1779570000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "business_customers" (
        "id" SERIAL NOT NULL,
        "business_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "joined_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_business_customers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_business_customers_business"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_business_customers_customer"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_business_customers_business_customer"
      ON "business_customers" ("business_id", "customer_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_business_customers_business_id"
      ON "business_customers" ("business_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_business_customers_customer_id"
      ON "business_customers" ("customer_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "business_customers"`);
  }
}
