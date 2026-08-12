import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIntegrationAuditLogsTable1786579200051 implements MigrationInterface {
  name = 'CreateIntegrationAuditLogsTable1786579200051';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('integration_audit_logs');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "integration_audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "business_id" integer NOT NULL, "provider" character varying(64) NOT NULL DEFAULT 'facebook', "event_type" character varying(64) NOT NULL, "status" character varying(32), "metadata" jsonb, "error_message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b9fbcf2db7632b74656f29e2974" PRIMARY KEY ("id"))`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "integration_audit_logs" CASCADE`);
  }
}
