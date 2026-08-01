import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenGoogleCampaignDrafts1779920000000
  implements MigrationInterface
{
  name = 'HardenGoogleCampaignDrafts1779920000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "google_campaign_drafts"
      ADD COLUMN IF NOT EXISTS "created_by" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "google_campaign_drafts"
      ADD COLUMN IF NOT EXISTS "updated_by" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "google_campaign_drafts"
      ADD COLUMN IF NOT EXISTS "last_idempotency_key" character varying(128)
    `);
    await queryRunner.query(`
      ALTER TABLE "google_campaign_drafts"
      ADD COLUMN IF NOT EXISTS "last_idempotency_response" jsonb
    `);

    await queryRunner.query(`
      UPDATE "google_campaign_drafts"
      SET "created_by" = "user_id"
      WHERE "created_by" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "google_campaign_drafts"
      SET "updated_by" = "user_id"
      WHERE "updated_by" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "google_campaign_drafts"
      SET "status" = UPPER("status")
      WHERE "status" IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "google_campaign_drafts"
      SET "status" = 'DRAFT'
      WHERE "status" IS NULL
         OR "status" NOT IN (
           'DRAFT',
           'VALIDATING',
           'PUBLISHING',
           'PUBLISHED',
           'FAILED',
           'ARCHIVED'
         )
    `);
    await queryRunner.query(`
      ALTER TABLE "google_campaign_drafts"
      ALTER COLUMN "status" SET DEFAULT 'DRAFT'
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_google_campaign_drafts_version"
      ON "google_campaign_drafts" ("id", "version")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_google_campaign_drafts_version"`,
    );
    await queryRunner.query(`
      ALTER TABLE "google_campaign_drafts"
      DROP COLUMN IF EXISTS "last_idempotency_response"
    `);
    await queryRunner.query(`
      ALTER TABLE "google_campaign_drafts"
      DROP COLUMN IF EXISTS "last_idempotency_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "google_campaign_drafts"
      DROP COLUMN IF EXISTS "updated_by"
    `);
    await queryRunner.query(`
      ALTER TABLE "google_campaign_drafts"
      DROP COLUMN IF EXISTS "created_by"
    `);
  }
}
