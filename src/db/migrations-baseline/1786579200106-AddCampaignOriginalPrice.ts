import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignOriginalPrice1786579200106 implements MigrationInterface {
  name = 'AddCampaignOriginalPrice1786579200106';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      ADD COLUMN IF NOT EXISTS "original_price" numeric(10,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      DROP COLUMN IF EXISTS "original_price"
    `);
  }
}
