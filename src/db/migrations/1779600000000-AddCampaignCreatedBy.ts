import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignCreatedBy1779600000000 implements MigrationInterface {
  name = 'AddCampaignCreatedBy1779600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      ADD COLUMN IF NOT EXISTS "created_by" integer
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_campaigns_created_by'
        ) THEN
          ALTER TABLE "campaigns"
          ADD CONSTRAINT "FK_campaigns_created_by"
          FOREIGN KEY ("created_by") REFERENCES "users"("id")
          ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      DROP CONSTRAINT IF EXISTS "FK_campaigns_created_by"
    `);
    await queryRunner.query(`
      ALTER TABLE "campaigns"
      DROP COLUMN IF EXISTS "created_by"
    `);
  }
}
