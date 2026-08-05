import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMetaProductEventsTable1779940000000
  implements MigrationInterface
{
  name = 'CreateMetaProductEventsTable1779940000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "meta_product_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "event_id" character varying(64) NOT NULL,
        "event_name" character varying(64) NOT NULL,
        "pixel_id" character varying(64) NOT NULL,
        "product" character varying(32) NOT NULL DEFAULT 'dealioo',
        "status" character varying(32) NOT NULL DEFAULT 'pending',
        "event_time" bigint NOT NULL,
        "event_source_url" text,
        "action_source" character varying(32) NOT NULL DEFAULT 'website',
        "fbp" character varying(255),
        "fbc" character varying(255),
        "fbclid" character varying(255),
        "user_data" jsonb,
        "custom_data" jsonb,
        "client_ip" character varying(64),
        "user_agent" text,
        "payload" jsonb,
        "meta_response" jsonb,
        "retry_count" integer NOT NULL DEFAULT 0,
        "last_error" text,
        "sent_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_meta_product_events" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_meta_product_events_event_id"
      ON "meta_product_events" ("event_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_meta_product_events_status_created"
      ON "meta_product_events" ("status", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_meta_product_events_event_name_created"
      ON "meta_product_events" ("event_name", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_meta_product_events_event_name_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_meta_product_events_status_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_meta_product_events_event_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "meta_product_events"`);
  }
}
