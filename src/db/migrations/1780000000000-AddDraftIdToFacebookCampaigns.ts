import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDraftIdToFacebookCampaigns1780000000000
  implements MigrationInterface
{
  name = 'AddDraftIdToFacebookCampaigns1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "facebook_campaigns"
      ADD COLUMN IF NOT EXISTS "draft_id" uuid
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_facebook_campaigns_draft_id"
      ON "facebook_campaigns" ("draft_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_facebook_campaigns_business_draft"
      ON "facebook_campaigns" ("business_id", "draft_id")
      WHERE "draft_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_facebook_campaigns_business_draft"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_facebook_campaigns_draft_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "facebook_campaigns"
      DROP COLUMN IF EXISTS "draft_id"
    `);
  }
}
