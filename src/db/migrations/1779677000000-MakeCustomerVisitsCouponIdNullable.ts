import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeCustomerVisitsCouponIdNullable1779677000000
  implements MigrationInterface
{
  name = 'MakeCustomerVisitsCouponIdNullable1779677000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customer_visits"
        ALTER COLUMN "coupon_id" DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "customer_visits"
      WHERE "coupon_id" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "customer_visits"
        ALTER COLUMN "coupon_id" SET NOT NULL
    `);
  }
}
