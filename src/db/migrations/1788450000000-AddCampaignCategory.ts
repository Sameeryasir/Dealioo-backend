import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignCategory1788450000000 implements MigrationInterface {
  name = 'AddCampaignCategory1788450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'campaigns_campaign_category_enum'
        ) THEN
          CREATE TYPE "campaigns_campaign_category_enum" AS ENUM (
            'food_and_beverage',
            'experiences',
            'retail',
            'other'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "campaigns"
      ADD COLUMN IF NOT EXISTS "campaign_category" "campaigns_campaign_category_enum"
      NOT NULL DEFAULT 'other'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      DROP COLUMN IF EXISTS "campaign_category"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "campaigns_campaign_category_enum"
    `);
  }
}
