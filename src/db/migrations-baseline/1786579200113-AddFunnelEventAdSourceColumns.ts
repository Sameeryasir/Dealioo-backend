import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFunnelEventAdSourceColumns1786579200113
  implements MigrationInterface
{
  name = 'AddFunnelEventAdSourceColumns1786579200113';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funnel_event"
        ADD COLUMN IF NOT EXISTS "ad_source" character varying(16),
        ADD COLUMN IF NOT EXISTS "ad_source_label" character varying(64),
        ADD COLUMN IF NOT EXISTS "ad_source_detail" character varying(255)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_event_funnel_ad_source"
        ON "funnel_event" ("funnel_id", "ad_source")
        WHERE "ad_source" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_event_funnel_ad_source"`,
    );
    await queryRunner.query(`
      ALTER TABLE "funnel_event"
        DROP COLUMN IF EXISTS "ad_source_detail",
        DROP COLUMN IF EXISTS "ad_source_label",
        DROP COLUMN IF EXISTS "ad_source"
    `);
  }
}
