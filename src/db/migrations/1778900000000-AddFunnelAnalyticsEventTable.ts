import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFunnelAnalyticsEventTable1778900000000
  implements MigrationInterface
{
  name = 'AddFunnelAnalyticsEventTable1778900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "funnel_analytics_event_event_type_enum" AS ENUM ('page_view', 'button_click', 'scroll', 'form_start', 'checkout_open', 'video_play', 'exit_intent')`,
    );
    await queryRunner.query(`
      CREATE TABLE "funnel_analytics_event" (
        "id" SERIAL NOT NULL,
        "funnel_id" integer NOT NULL,
        "visitor_id" character varying(64),
        "customer_id" integer,
        "session_id" character varying(64),
        "event_type" "funnel_analytics_event_event_type_enum" NOT NULL,
        "page_path" character varying(512),
        "step_name" character varying(64),
        "step_order" integer,
        "utm_source" character varying(255),
        "utm_medium" character varying(255),
        "utm_campaign" character varying(255),
        "referrer" character varying(512),
        "metadata" jsonb,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_funnel_analytics_event" PRIMARY KEY ("id"),
        CONSTRAINT "FK_funnel_analytics_event_funnel" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_funnel_analytics_event_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_funnel_analytics_funnel_created"
      ON "funnel_analytics_event" ("funnel_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_funnel_analytics_funnel_event_type"
      ON "funnel_analytics_event" ("funnel_id", "event_type")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_funnel_analytics_funnel_step"
      ON "funnel_analytics_event" ("funnel_id", "step_name", "step_order")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_analytics_funnel_step"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_analytics_funnel_event_type"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_analytics_funnel_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "funnel_analytics_event"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "funnel_analytics_event_event_type_enum"`,
    );
  }
}
