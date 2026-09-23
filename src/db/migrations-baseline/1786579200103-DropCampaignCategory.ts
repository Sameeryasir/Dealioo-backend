import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropCampaignCategory1786579200103 implements MigrationInterface {
  name = 'DropCampaignCategory1786579200103';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      DROP COLUMN IF EXISTS "campaign_category"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "campaigns_campaign_category_enum"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
            'restaurants_cafes',
            'coffee_tea',
            'grocery_markets',
            'beauty_wellness',
            'fitness_sports',
            'health_medical',
            'retail',
            'fashion_apparel',
            'experiences',
            'entertainment',
            'events_nightlife',
            'travel_hospitality',
            'home_services',
            'automotive',
            'education',
            'professional_services',
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
}
