import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveBusinessCuisineTypeAndMenuTables1779460000000
  implements MigrationInterface
{
  name = 'RemoveBusinessCuisineTypeAndMenuTables1779460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Legacy menu tables are no longer used — drop child table first.
    await queryRunner.query(`DROP TABLE IF EXISTS "menu_items" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "menus" CASCADE`);

    await queryRunner.query(`
      ALTER TABLE "businesses"
      DROP COLUMN IF EXISTS "cuisine_type"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "businesses"
      ADD COLUMN IF NOT EXISTS "cuisine_type" character varying
    `);
  }
}
