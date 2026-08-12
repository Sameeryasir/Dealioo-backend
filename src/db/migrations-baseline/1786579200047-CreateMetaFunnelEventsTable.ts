import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMetaFunnelEventsTable1786579200047 implements MigrationInterface {
  name = 'CreateMetaFunnelEventsTable1786579200047';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('meta_funnel_events');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "meta_funnel_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "event_id" character varying(64) NOT NULL, "event_name" character varying(64) NOT NULL, "business_id" integer NOT NULL, "funnel_id" integer, "pixel_id" character varying(64) NOT NULL, "status" character varying(32) NOT NULL DEFAULT 'stored', "event_time" bigint NOT NULL, "event_source_url" text, "action_source" character varying(32) NOT NULL DEFAULT 'website', "fbp" character varying(255), "fbc" character varying(255), "fbclid" character varying(255), "user_data" jsonb, "custom_data" jsonb, "client_ip" character varying(64), "user_agent" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_309c35bf3f88c96dae819cb0a4d" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meta_funnel_events_status_created" ON "meta_funnel_events" ("status", "created_at") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meta_funnel_events_funnel_created" ON "meta_funnel_events" ("funnel_id", "created_at") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meta_funnel_events_business_created" ON "meta_funnel_events" ("business_id", "created_at") `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_meta_funnel_events_event_id" ON "meta_funnel_events" ("event_id") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "meta_funnel_events" CASCADE`);
  }
}
