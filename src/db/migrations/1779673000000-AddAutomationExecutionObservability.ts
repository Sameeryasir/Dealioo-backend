import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutomationExecutionObservability1779673000000
  implements MigrationInterface
{
  name = 'AddAutomationExecutionObservability1779673000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "automation_execution"
      ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "attempt_number" integer NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS "next_retry_at" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "recipients_found" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "recipients_eligible" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "recipients_filtered" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "recipients_sent" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "recipients_failed" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "recipients_skipped" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "recipients_bounced" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "recipients_paid_during_wait" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "pass_emails_sent" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "summary" jsonb NULL
    `);

    await queryRunner.query(`
      UPDATE "automation_execution"
      SET "started_at" = COALESCE("started_at", "created_at"),
          "recipients_found" = COALESCE(NULLIF("recipients_found", 0), "total_recipients"),
          "recipients_eligible" = COALESCE(NULLIF("recipients_eligible", 0), "total_recipients"),
          "recipients_sent" = COALESCE(NULLIF("recipients_sent", 0), "emails_sent_count")
      WHERE "started_at" IS NULL
         OR "recipients_found" = 0
         OR "recipients_sent" = 0
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation_execution_step" (
        "id" SERIAL NOT NULL,
        "execution_id" integer NOT NULL,
        "node_id" integer NULL,
        "step_key" varchar(64) NOT NULL,
        "step_label" varchar(255) NOT NULL,
        "phase" varchar(32) NULL,
        "status" varchar(32) NOT NULL DEFAULT 'pending',
        "started_at" TIMESTAMPTZ NULL,
        "completed_at" TIMESTAMPTZ NULL,
        "duration_ms" integer NULL,
        "recipients_total" integer NOT NULL DEFAULT 0,
        "recipients_sent" integer NOT NULL DEFAULT 0,
        "recipients_failed" integer NOT NULL DEFAULT 0,
        "recipients_skipped" integer NOT NULL DEFAULT 0,
        "error" text NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_execution_step" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_automation_execution_step_exec_key"
          UNIQUE ("execution_id", "step_key"),
        CONSTRAINT "FK_automation_execution_step_execution"
          FOREIGN KEY ("execution_id") REFERENCES "automation_execution"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_automation_execution_step_node"
          FOREIGN KEY ("node_id") REFERENCES "automation_node"("id")
          ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation_execution_recipient" (
        "id" SERIAL NOT NULL,
        "execution_id" integer NOT NULL,
        "step_id" integer NULL,
        "customer_id" integer NOT NULL,
        "node_id" integer NULL,
        "phase" varchar(32) NULL,
        "status" varchar(32) NOT NULL,
        "reason" varchar(255) NULL,
        "attempt" integer NOT NULL DEFAULT 1,
        "provider_response" jsonb NULL,
        "error" text NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_execution_recipient" PRIMARY KEY ("id"),
        CONSTRAINT "FK_automation_execution_recipient_execution"
          FOREIGN KEY ("execution_id") REFERENCES "automation_execution"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_automation_execution_recipient_step"
          FOREIGN KEY ("step_id") REFERENCES "automation_execution_step"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_automation_execution_recipient_customer"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_automation_execution_recipient_node"
          FOREIGN KEY ("node_id") REFERENCES "automation_node"("id")
          ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_execution_automation_status"
      ON "automation_execution" ("automation_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_execution_automation_created"
      ON "automation_execution" ("automation_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_execution_status_updated"
      ON "automation_execution" ("status", "updated_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_log_execution_created"
      ON "automation_log" ("execution_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_execution_step_execution"
      ON "automation_execution_step" ("execution_id", "id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_execution_recipient_exec_customer"
      ON "automation_execution_recipient" ("execution_id", "customer_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_execution_recipient_customer_occurred"
      ON "automation_execution_recipient" ("customer_id", "occurred_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_execution_recipient_status"
      ON "automation_execution_recipient" ("execution_id", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_automation_execution_recipient_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_automation_execution_recipient_customer_occurred"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_automation_execution_recipient_exec_customer"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_automation_execution_step_execution"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_automation_log_execution_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_automation_execution_status_updated"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_automation_execution_automation_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_automation_execution_automation_status"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "automation_execution_recipient"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "automation_execution_step"`,
    );
    await queryRunner.query(`
      ALTER TABLE "automation_execution"
      DROP COLUMN IF EXISTS "summary",
      DROP COLUMN IF EXISTS "pass_emails_sent",
      DROP COLUMN IF EXISTS "recipients_paid_during_wait",
      DROP COLUMN IF EXISTS "recipients_bounced",
      DROP COLUMN IF EXISTS "recipients_skipped",
      DROP COLUMN IF EXISTS "recipients_failed",
      DROP COLUMN IF EXISTS "recipients_sent",
      DROP COLUMN IF EXISTS "recipients_filtered",
      DROP COLUMN IF EXISTS "recipients_eligible",
      DROP COLUMN IF EXISTS "recipients_found",
      DROP COLUMN IF EXISTS "next_retry_at",
      DROP COLUMN IF EXISTS "attempt_number",
      DROP COLUMN IF EXISTS "completed_at",
      DROP COLUMN IF EXISTS "started_at"
    `);
  }
}
