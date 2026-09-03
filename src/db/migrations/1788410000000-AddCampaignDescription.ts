import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignDescription1788410000000 implements MigrationInterface {
  name = 'AddCampaignDescription1788410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
        ADD COLUMN IF NOT EXISTS "description" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
        DROP COLUMN IF EXISTS "description"
    `);
  }
}
