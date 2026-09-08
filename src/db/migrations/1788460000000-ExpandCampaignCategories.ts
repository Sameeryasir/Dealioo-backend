import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Expand campaigns_campaign_category_enum from 4 values to the full category set.
 * What changed: add 14 industry categories. Why: Performance + create dropdown need ~10–20 types.
 * Related: campaign.entity.ts CampaignCategory, FE app/lib/campaign-category.ts
 */
export class ExpandCampaignCategories1788460000000
  implements MigrationInterface
{
  name = 'ExpandCampaignCategories1788460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const values = [
      'restaurants_cafes',
      'coffee_tea',
      'grocery_markets',
      'beauty_wellness',
      'fitness_sports',
      'health_medical',
      'fashion_apparel',
      'entertainment',
      'events_nightlife',
      'travel_hospitality',
      'home_services',
      'automotive',
      'education',
      'professional_services',
    ];

    for (const value of values) {
      // Postgres: ADD VALUE cannot run inside a transaction block on older versions;
      // TypeORM wraps migrations in a transaction — use DO block with exception handling.
      await queryRunner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'campaigns_campaign_category_enum'
              AND e.enumlabel = '${value}'
          ) THEN
            ALTER TYPE "campaigns_campaign_category_enum" ADD VALUE '${value}';
          END IF;
        END $$;
      `);
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Postgres cannot remove enum values safely without recreating the type.
    // Leaving added values in place on down is intentional.
  }
}
