import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFunnelSoftDelete1779630000000 implements MigrationInterface {
  name = 'AddFunnelSoftDelete1779630000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funnels"
      ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnels_deleted_at"
      ON "funnels" ("deleted_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_funnels_deleted_at"`);
    await queryRunner.query(`
      ALTER TABLE "funnels" DROP COLUMN IF EXISTS "deleted_at"
    `);
  }
}
