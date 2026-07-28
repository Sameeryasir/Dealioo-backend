import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropFunnelsPagesColumn1779770000000 implements MigrationInterface {
  name = 'DropFunnelsPagesColumn1779770000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funnels" DROP COLUMN IF EXISTS "pages"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funnels"
      ADD COLUMN IF NOT EXISTS "pages" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);

    await queryRunner.query(`
      UPDATE "funnels" f
      SET "pages" = COALESCE((
        SELECT jsonb_object_agg(fp."page_type"::text, fp."schema")
        FROM "funnel_pages" fp
        WHERE fp."funnel_id" = f."id"
      ), '{}'::jsonb)
    `);
  }
}
