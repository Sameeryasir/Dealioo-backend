import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignStripeColumns1779820000000
  implements MigrationInterface
{
  name = 'AddCampaignStripeColumns1779820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('campaigns'))) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "campaigns"
      ADD COLUMN IF NOT EXISTS "stripe_product_id" character varying(255) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      ADD COLUMN IF NOT EXISTS "stripe_price_id" character varying(255) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('campaigns'))) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "campaigns"
      DROP COLUMN IF EXISTS "stripe_price_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      DROP COLUMN IF EXISTS "stripe_product_id"
    `);
  }
}
