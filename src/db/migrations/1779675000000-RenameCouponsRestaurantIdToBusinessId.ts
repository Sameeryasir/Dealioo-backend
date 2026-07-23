import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameCouponsRestaurantIdToBusinessId1779675000000
  implements MigrationInterface
{
  name = 'RenameCouponsRestaurantIdToBusinessId1779675000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "coupons"
        DROP CONSTRAINT IF EXISTS "FK_coupons_restaurant"
    `);

    await queryRunner.query(`
      ALTER TABLE "coupons"
        RENAME COLUMN "restaurant_id" TO "business_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "coupons"
        DROP COLUMN IF EXISTS "register_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "coupons"
        ADD CONSTRAINT "FK_coupons_business"
        FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
        ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "coupons"
        DROP CONSTRAINT IF EXISTS "FK_coupons_business"
    `);

    await queryRunner.query(`
      ALTER TABLE "coupons"
        ADD COLUMN IF NOT EXISTS "register_id" character varying(64)
    `);

    await queryRunner.query(`
      ALTER TABLE "coupons"
        RENAME COLUMN "business_id" TO "restaurant_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "coupons"
        ADD CONSTRAINT "FK_coupons_restaurant"
        FOREIGN KEY ("restaurant_id") REFERENCES "businesses"("id")
        ON DELETE RESTRICT
    `);
  }
}
