import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBusinessCustomersTable1786579200009 implements MigrationInterface {
  name = 'CreateBusinessCustomersTable1786579200009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('business_customers');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "business_customers" ("id" SERIAL NOT NULL, "business_id" integer NOT NULL, "customer_id" integer NOT NULL, "joined_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_business_customers_business_customer" UNIQUE ("business_id", "customer_id"), CONSTRAINT "PK_00f259de4845e644ba833fd6171" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_2189a241d1533a1d99cfa88fc7c' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "business_customers" ADD CONSTRAINT "FK_2189a241d1533a1d99cfa88fc7c" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_c599152d2cfac4753b686722c44' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "business_customers" ADD CONSTRAINT "FK_c599152d2cfac4753b686722c44" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "business_customers" CASCADE`);
  }
}
