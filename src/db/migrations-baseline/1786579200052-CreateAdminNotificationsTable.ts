import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminNotificationsTable1786579200052 implements MigrationInterface {
  name = 'CreateAdminNotificationsTable1786579200052';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('admin_notifications');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "admin_notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" character varying(32) NOT NULL, "event_key" character varying(100) NOT NULL, "title" character varying(255) NOT NULL, "body" text NOT NULL, "severity" character varying(16) NOT NULL DEFAULT 'info', "action_url" character varying(500), "resource_type" character varying(50), "resource_id" character varying(100), "actor_user_id" integer, "idempotency_key" character varying(191) NOT NULL, "metadata" jsonb, "is_read" boolean NOT NULL DEFAULT false, "read_at" TIMESTAMP WITH TIME ZONE, "is_archived" boolean NOT NULL DEFAULT false, "source" character varying(32) NOT NULL DEFAULT 'system', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1fecd1cab747b7ab6e850091901" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_admin_notifications_idempotency_key" ON "admin_notifications" ("idempotency_key") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_notifications_resource" ON "admin_notifications" ("resource_type", "resource_id") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_notifications_severity" ON "admin_notifications" ("severity", "created_at") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_notifications_type" ON "admin_notifications" ("type", "created_at") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_notifications_unread" ON "admin_notifications" ("is_read", "created_at") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_notifications_created" ON "admin_notifications" ("created_at") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_notifications" CASCADE`);
  }
}
