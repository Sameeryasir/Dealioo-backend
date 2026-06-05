import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerVisitStaffAndSource1779070000000
  implements MigrationInterface
{
  name = 'AddCustomerVisitStaffAndSource1779070000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customer_visits"
      ADD COLUMN "staff_user_id" integer
    `);

    await queryRunner.query(`
      ALTER TABLE "customer_visits"
      ADD COLUMN "source" character varying(32) NOT NULL DEFAULT 'QR_REDEMPTION'
    `);

    await queryRunner.query(`
      ALTER TABLE "customer_visits"
      ADD CONSTRAINT "FK_customer_visits_staff_user"
      FOREIGN KEY ("staff_user_id")
      REFERENCES "users"("id")
      ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customer_visits"
      DROP CONSTRAINT IF EXISTS "FK_customer_visits_staff_user"
    `);
    await queryRunner.query(`
      ALTER TABLE "customer_visits"
      DROP COLUMN IF EXISTS "source"
    `);
    await queryRunner.query(`
      ALTER TABLE "customer_visits"
      DROP COLUMN IF EXISTS "staff_user_id"
    `);
  }
}
