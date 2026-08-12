import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFunnelPagesTable1786579200015 implements MigrationInterface {
  name = 'CreateFunnelPagesTable1786579200015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('funnel_pages');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "funnel_pages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "funnel_id" integer NOT NULL, "page_type" "public"."funnel_page_type" NOT NULL, "schema" jsonb NOT NULL DEFAULT '{}', "current_version" integer NOT NULL DEFAULT '1', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9d709de303d1448e1778b90d3a4" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_funnel_pages_funnel_id" ON "funnel_pages" ("funnel_id") `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_funnel_pages_funnel_type" ON "funnel_pages" ("funnel_id", "page_type") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_718869786b66a5be0dfae48f0d7' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnel_pages" ADD CONSTRAINT "FK_718869786b66a5be0dfae48f0d7" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "funnel_pages" CASCADE`);
  }
}
