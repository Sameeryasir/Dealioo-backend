import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessDeletedAt1786579200102 implements MigrationInterface {
  name = 'AddBusinessDeletedAt1786579200102';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('businesses');
    if (!hasTable) return;

    await queryRunner.query(`
      ALTER TABLE "businesses"
      ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_businesses_deleted_at"
      ON "businesses" ("deleted_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('businesses');
    if (!hasTable) return;

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_businesses_deleted_at"
    `);

    await queryRunner.query(`
      ALTER TABLE "businesses"
      DROP COLUMN IF EXISTS "deleted_at"
    `);
  }
}
