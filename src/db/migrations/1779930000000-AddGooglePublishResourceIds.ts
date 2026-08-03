import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGooglePublishResourceIds1779930000000
  implements MigrationInterface
{
  name = 'AddGooglePublishResourceIds1779930000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "google_campaign_drafts"
      ADD COLUMN IF NOT EXISTS "google_budget_id" character varying(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "google_campaign_drafts"
      ADD COLUMN IF NOT EXISTS "google_ad_group_id" character varying(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "google_campaign_drafts"
      ADD COLUMN IF NOT EXISTS "google_ad_id" character varying(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "google_campaign_drafts"
      ADD COLUMN IF NOT EXISTS "google_keyword_ids" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "google_campaign_drafts"
      DROP COLUMN IF EXISTS "google_keyword_ids"
    `);
    await queryRunner.query(`
      ALTER TABLE "google_campaign_drafts"
      DROP COLUMN IF EXISTS "google_ad_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "google_campaign_drafts"
      DROP COLUMN IF EXISTS "google_ad_group_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "google_campaign_drafts"
      DROP COLUMN IF EXISTS "google_budget_id"
    `);
  }
}
