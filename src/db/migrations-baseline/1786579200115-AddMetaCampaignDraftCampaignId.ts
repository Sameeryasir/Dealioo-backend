import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMetaCampaignDraftCampaignId1786579200115
  implements MigrationInterface
{
  name = 'AddMetaCampaignDraftCampaignId1786579200115';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meta_campaign_drafts"
        ADD COLUMN IF NOT EXISTS "campaign_id" integer
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_meta_campaign_drafts_campaign_id"
        ON "meta_campaign_drafts" ("campaign_id")
        WHERE "campaign_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_meta_campaign_drafts_campaign_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "meta_campaign_drafts"
        DROP COLUMN IF EXISTS "campaign_id"
    `);
  }
}
