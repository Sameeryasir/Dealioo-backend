import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignDiscountTypeAndValue1786579200126
  implements MigrationInterface
{
  name = 'AddCampaignDiscountTypeAndValue1786579200126';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "campaigns_discount_type_enum" AS ENUM ('percent', 'fixed');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      ADD COLUMN IF NOT EXISTS "discount_type" "campaigns_discount_type_enum"
    `);
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      ADD COLUMN IF NOT EXISTS "discount_value" numeric(10,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      DROP COLUMN IF EXISTS "discount_value"
    `);
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      DROP COLUMN IF EXISTS "discount_type"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "campaigns_discount_type_enum"
    `);
  }
}
