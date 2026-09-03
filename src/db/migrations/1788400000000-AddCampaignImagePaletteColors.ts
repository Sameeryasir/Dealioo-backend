import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignImagePaletteColors1788400000000
  implements MigrationInterface
{
  name = 'AddCampaignImagePaletteColors1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
        ADD COLUMN IF NOT EXISTS "image_primary_color" character varying(16),
        ADD COLUMN IF NOT EXISTS "image_secondary_color" character varying(16),
        ADD COLUMN IF NOT EXISTS "image_accent_color" character varying(16)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
        DROP COLUMN IF EXISTS "image_accent_color",
        DROP COLUMN IF EXISTS "image_secondary_color",
        DROP COLUMN IF EXISTS "image_primary_color"
    `);
  }
}
