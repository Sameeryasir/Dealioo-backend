import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminNotificationsTable1779980000000
  implements MigrationInterface
{
  name = 'CreateAdminNotificationsTable1779980000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_notifications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "type" character varying(32) NOT NULL,
        "event_key" character varying(100) NOT NULL,
        "title" character varying(255) NOT NULL,
        "body" text NOT NULL,
        "severity" character varying(16) NOT NULL DEFAULT 'info',
        "action_url" character varying(500),
        "resource_type" character varying(50),
        "resource_id" character varying(100),
        "actor_user_id" integer,
        "idempotency_key" character varying(191) NOT NULL,
        "metadata" jsonb,
        "is_read" boolean NOT NULL DEFAULT false,
        "read_at" TIMESTAMPTZ,
        "is_archived" boolean NOT NULL DEFAULT false,
        "source" character varying(32) NOT NULL DEFAULT 'system',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_notifications" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_admin_notifications_created"
      ON "admin_notifications" ("created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_admin_notifications_unread"
      ON "admin_notifications" ("is_read", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_admin_notifications_type"
      ON "admin_notifications" ("type", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_admin_notifications_severity"
      ON "admin_notifications" ("severity", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_admin_notifications_resource"
      ON "admin_notifications" ("resource_type", "resource_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_admin_notifications_idempotency_key"
      ON "admin_notifications" ("idempotency_key")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_admin_notifications_idempotency_key"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_admin_notifications_resource"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_admin_notifications_severity"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_admin_notifications_type"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_admin_notifications_unread"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_admin_notifications_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_notifications"`);
  }
}
