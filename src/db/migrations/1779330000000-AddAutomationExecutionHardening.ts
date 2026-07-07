import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutomationExecutionHardening1779330000000
  implements MigrationInterface
{
  name = 'AddAutomationExecutionHardening1779330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "automation"
      ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1
    `);

    await queryRunner.query(`
      ALTER TABLE "automation_execution"
      ADD COLUMN IF NOT EXISTS "automation_version" integer,
      ADD COLUMN IF NOT EXISTS "execution_context" jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS "last_event_id" integer
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation_execution_event" (
        "id" SERIAL NOT NULL,
        "execution_id" integer NOT NULL,
        "event_type" character varying(64) NOT NULL,
        "node_id" integer,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_execution_event" PRIMARY KEY ("id"),
        CONSTRAINT "FK_automation_execution_event_execution_id"
          FOREIGN KEY ("execution_id") REFERENCES "automation_execution"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_execution_event_node_id"
          FOREIGN KEY ("node_id") REFERENCES "automation_node"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_execution_event_execution_id"
      ON "automation_execution_event" ("execution_id", "id")
    `);

    await queryRunner.query(`
      ALTER TABLE "automation_execution"
      ADD CONSTRAINT "FK_automation_execution_last_event_id"
      FOREIGN KEY ("last_event_id") REFERENCES "automation_execution_event"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation_dead_letter" (
        "id" SERIAL NOT NULL,
        "execution_id" integer,
        "automation_id" integer,
        "customer_id" integer,
        "job_name" character varying(64) NOT NULL,
        "job_id" character varying(128) NOT NULL,
        "job_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "node_id" integer,
        "node_type" character varying(32),
        "error" text NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "status" character varying(32) NOT NULL DEFAULT 'pending',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "retried_at" TIMESTAMPTZ,
        CONSTRAINT "PK_automation_dead_letter" PRIMARY KEY ("id"),
        CONSTRAINT "FK_automation_dead_letter_execution_id"
          FOREIGN KEY ("execution_id") REFERENCES "automation_execution"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_dead_letter_status_created"
      ON "automation_dead_letter" ("status", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_execution_waiting_scheduled"
      ON "automation_execution" ("scheduled_at")
      WHERE "status" = 'waiting'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_automation_execution_waiting_scheduled"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_dead_letter"`);
    await queryRunner.query(`
      ALTER TABLE "automation_execution"
      DROP CONSTRAINT IF EXISTS "FK_automation_execution_last_event_id"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_execution_event"`);
    await queryRunner.query(`
      ALTER TABLE "automation_execution"
      DROP COLUMN IF EXISTS "last_event_id",
      DROP COLUMN IF EXISTS "execution_context",
      DROP COLUMN IF EXISTS "automation_version"
    `);
    await queryRunner.query(`
      ALTER TABLE "automation" DROP COLUMN IF EXISTS "version"
    `);
  }
}
