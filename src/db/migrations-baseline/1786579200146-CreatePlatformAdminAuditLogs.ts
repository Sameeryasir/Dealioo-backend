import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformAdminAuditLogs1786579200146
  implements MigrationInterface
{
  name = 'CreatePlatformAdminAuditLogs1786579200146';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_admin_audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "actor_user_id" integer NOT NULL,
        "action" character varying(64) NOT NULL,
        "target_type" character varying(32) NOT NULL,
        "target_id" character varying(64),
        "metadata" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_admin_audit_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_platform_admin_audit_actor_created"
      ON "platform_admin_audit_logs" ("actor_user_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_platform_admin_audit_actor_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_admin_audit_logs"`);
  }
}
