import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFunnelVersionsDropFunnelVersion1779740000000
  implements MigrationInterface
{
  name = 'CreateFunnelVersionsDropFunnelVersion1779740000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "funnel_versions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "funnel_id" integer NOT NULL,
        "business_id" integer NULL,
        "version_number" integer NOT NULL,
        "schema" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "operation_id" character varying(64) NULL,
        "created_by" integer NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_funnel_versions_funnel_id"
          FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_funnel_versions_business_id"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_funnel_versions_created_by"
          FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_funnel_versions_funnel_version"
      ON "funnel_versions" ("funnel_id", "version_number")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_versions_funnel_created"
      ON "funnel_versions" ("funnel_id", "created_at")
    `);

    await queryRunner.query(`
      INSERT INTO "funnel_versions" (
        "funnel_id",
        "business_id",
        "version_number",
        "schema",
        "created_by",
        "created_at"
      )
      SELECT
        f."id",
        c."restaurant_id",
        COALESCE(f."version", 1),
        COALESCE(f."pages", '{}'::jsonb),
        f."updated_by",
        COALESCE(f."updated_at", f."created_at", now())
      FROM "funnels" f
      LEFT JOIN "campaigns" c ON c."id" = f."campaign_id"
      WHERE NOT EXISTS (
        SELECT 1
        FROM "funnel_versions" fv
        WHERE fv."funnel_id" = f."id"
          AND fv."version_number" = COALESCE(f."version", 1)
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "funnels"
      DROP COLUMN IF EXISTS "version"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funnels"
      ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1
    `);

    await queryRunner.query(`
      UPDATE "funnels" f
      SET "version" = COALESCE((
        SELECT MAX(fv."version_number")
        FROM "funnel_versions" fv
        WHERE fv."funnel_id" = f."id"
      ), 1)
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_funnel_versions_funnel_created"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_funnel_versions_funnel_version"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "funnel_versions"
    `);
  }
}
