import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignType1779790000000 implements MigrationInterface {
  name = 'AddCampaignType1779790000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'campaigns_campaign_type_enum'
        ) THEN
          CREATE TYPE "campaigns_campaign_type_enum" AS ENUM ('prepaid', 'postpaid');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "campaigns"
      ADD COLUMN IF NOT EXISTS "campaign_type" "campaigns_campaign_type_enum"
      NOT NULL DEFAULT 'prepaid'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      DROP COLUMN IF EXISTS "campaign_type"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "campaigns_campaign_type_enum"
    `);
  }
}
