import { MigrationInterface, QueryRunner } from 'typeorm';

export class FunnelCampaignOneToOne1778600000000 implements MigrationInterface {
  name = 'FunnelCampaignOneToOne1778600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "funnels" f
      WHERE f.id IN (
        SELECT id FROM (
          SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY campaign_id ORDER BY id DESC
            ) AS rn
          FROM "funnels"
        ) ranked
        WHERE ranked.rn > 1
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "funnels"
      ADD CONSTRAINT "UQ_funnels_campaign_id" UNIQUE ("campaign_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funnels" DROP CONSTRAINT IF EXISTS "UQ_funnels_campaign_id"
    `);
  }
}
