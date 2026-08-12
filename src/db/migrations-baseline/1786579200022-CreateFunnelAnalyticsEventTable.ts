import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFunnelAnalyticsEventTable1786579200022 implements MigrationInterface {
  name = 'CreateFunnelAnalyticsEventTable1786579200022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('funnel_analytics_event');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "funnel_analytics_event" ("id" SERIAL NOT NULL, "funnel_id" integer, "visitor_id" character varying(64), "customer_id" integer, "session_id" character varying(64), "event_type" "public"."funnel_analytics_event_event_type_enum" NOT NULL, "page_path" character varying(512), "step_name" character varying(64), "step_order" integer, "utm_source" character varying(255), "utm_medium" character varying(255), "utm_campaign" character varying(255), "referrer" character varying(512), "metadata" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_919572245372605e40923e84f3f" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_funnel_analytics_funnel_event_type" ON "funnel_analytics_event" ("funnel_id", "event_type") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_funnel_analytics_funnel_created" ON "funnel_analytics_event" ("funnel_id", "created_at") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_972628da23651a2f4654b8fa0bf' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnel_analytics_event" ADD CONSTRAINT "FK_972628da23651a2f4654b8fa0bf" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_112b79c3b215d46cd2939ff3dfa' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnel_analytics_event" ADD CONSTRAINT "FK_112b79c3b215d46cd2939ff3dfa" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "funnel_analytics_event" CASCADE`);
  }
}
