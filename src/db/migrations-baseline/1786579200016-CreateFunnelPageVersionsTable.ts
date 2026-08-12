import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFunnelPageVersionsTable1786579200016 implements MigrationInterface {
  name = 'CreateFunnelPageVersionsTable1786579200016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('funnel_page_versions');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "funnel_page_versions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "funnel_page_id" uuid NOT NULL, "funnel_id" integer NOT NULL, "page_type" "public"."funnel_page_type" NOT NULL, "business_id" integer, "version_number" integer NOT NULL, "schema" jsonb NOT NULL DEFAULT '{}', "operation_id" character varying(64), "created_by" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_29becd7dfd7c05d5c86352779c3" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_funnel_page_versions_operation" ON "funnel_page_versions" ("operation_id") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_funnel_page_versions_funnel_type_created" ON "funnel_page_versions" ("funnel_id", "page_type", "created_at") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_funnel_page_versions_funnel_created" ON "funnel_page_versions" ("funnel_id", "created_at") `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_funnel_page_versions_page_version" ON "funnel_page_versions" ("funnel_page_id", "version_number") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_97922208955dab43b6eae8a290a' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnel_page_versions" ADD CONSTRAINT "FK_97922208955dab43b6eae8a290a" FOREIGN KEY ("funnel_page_id") REFERENCES "funnel_pages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_3b0c478c97a8bea9d360514447f' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnel_page_versions" ADD CONSTRAINT "FK_3b0c478c97a8bea9d360514447f" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_95862391457e591e7beb2f30dc7' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnel_page_versions" ADD CONSTRAINT "FK_95862391457e591e7beb2f30dc7" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_5a6c0183327b88ffa396efc877f' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnel_page_versions" ADD CONSTRAINT "FK_5a6c0183327b88ffa396efc877f" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "funnel_page_versions" CASCADE`);
  }
}
