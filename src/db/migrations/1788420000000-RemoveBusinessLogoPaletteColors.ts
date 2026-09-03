import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Change: Drop business logo palette columns.
 * Why: Color extraction is no longer used for businesses (campaigns keep image palette).
 * Related: AddBusinessLogoPaletteColors1788390000000
 */
export class RemoveBusinessLogoPaletteColors1788420000000
  implements MigrationInterface
{
  name = 'RemoveBusinessLogoPaletteColors1788420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "businesses"
        DROP COLUMN IF EXISTS "logo_accent_color",
        DROP COLUMN IF EXISTS "logo_secondary_color",
        DROP COLUMN IF EXISTS "logo_primary_color"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "businesses"
        ADD COLUMN IF NOT EXISTS "logo_primary_color" character varying(16),
        ADD COLUMN IF NOT EXISTS "logo_secondary_color" character varying(16),
        ADD COLUMN IF NOT EXISTS "logo_accent_color" character varying(16)
    `);
  }
}
