import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFunnelPagesAndPageVersions1779760000000
  implements MigrationInterface
{
  name = 'CreateFunnelPagesAndPageVersions1779760000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "funnel_page_type" AS ENUM (
          'landing',
          'signup',
          'payment',
          'confirmation'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "funnels"
        ADD COLUMN IF NOT EXISTS "business_id" integer NULL,
        ADD COLUMN IF NOT EXISTS "content_revision" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "funnels"
          ADD CONSTRAINT "FK_funnels_business_id"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
          ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      UPDATE "funnels" f
      SET "business_id" = c."business_id"
      FROM "campaigns" c
      WHERE c."id" = f."campaign_id"
        AND f."business_id" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnels_business_id"
      ON "funnels" ("business_id")
      WHERE "business_id" IS NOT NULL AND "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "funnel_pages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "funnel_id" integer NOT NULL,
        "page_type" "funnel_page_type" NOT NULL,
        "schema" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "current_version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_funnel_pages_funnel_id"
          FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_funnel_pages_funnel_type" UNIQUE ("funnel_id", "page_type")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_pages_funnel_id"
      ON "funnel_pages" ("funnel_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "funnel_page_versions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "funnel_page_id" uuid NOT NULL,
        "funnel_id" integer NOT NULL,
        "page_type" "funnel_page_type" NOT NULL,
        "business_id" integer NULL,
        "version_number" integer NOT NULL,
        "schema" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "operation_id" character varying(64) NULL,
        "created_by" integer NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_funnel_page_versions_page_id"
          FOREIGN KEY ("funnel_page_id") REFERENCES "funnel_pages"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_funnel_page_versions_funnel_id"
          FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_funnel_page_versions_business_id"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_funnel_page_versions_created_by"
          FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "uq_funnel_page_versions_page_version"
          UNIQUE ("funnel_page_id", "version_number")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_page_versions_funnel_created"
      ON "funnel_page_versions" ("funnel_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_page_versions_funnel_type_created"
      ON "funnel_page_versions" ("funnel_id", "page_type", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_page_versions_operation"
      ON "funnel_page_versions" ("operation_id")
      WHERE "operation_id" IS NOT NULL
    `);

        await queryRunner.query(`
      INSERT INTO "funnel_pages" ("funnel_id", "page_type", "schema", "current_version")
      SELECT
        f."id",
        p.page_type::"funnel_page_type",
        COALESCE(f."pages" -> p.page_type, '{}'::jsonb),
        1
      FROM "funnels" f
      CROSS JOIN (
        VALUES ('landing'), ('signup'), ('payment'), ('confirmation')
      ) AS p(page_type)
      ON CONFLICT ("funnel_id", "page_type") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "funnel_page_versions" (
        "funnel_page_id",
        "funnel_id",
        "page_type",
        "business_id",
        "version_number",
        "schema",
        "created_by",
        "created_at"
      )
      SELECT
        fp."id",
        fp."funnel_id",
        fp."page_type",
        f."business_id",
        1,
        fp."schema",
        f."updated_by",
        COALESCE(f."updated_at", f."created_at", now())
      FROM "funnel_pages" fp
      JOIN "funnels" f ON f."id" = fp."funnel_id"
      WHERE NOT EXISTS (
        SELECT 1
        FROM "funnel_page_versions" fpv
        WHERE fpv."funnel_page_id" = fp."id"
          AND fpv."version_number" = 1
      )
    `);

    await queryRunner.query(`
      UPDATE "funnels" f
      SET "content_revision" = COALESCE((
        SELECT MAX(fv."version_number")
        FROM "funnel_versions" fv
        WHERE fv."funnel_id" = f."id"
      ), 1)
      WHERE f."content_revision" = 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "funnel_page_versions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "funnel_pages"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_funnels_business_id"`);
    await queryRunner.query(`
      ALTER TABLE "funnels"
        DROP CONSTRAINT IF EXISTS "FK_funnels_business_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnels"
        DROP COLUMN IF EXISTS "content_revision",
        DROP COLUMN IF EXISTS "business_id"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "funnel_page_type"`);
  }
}
