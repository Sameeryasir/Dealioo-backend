import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentReminderWaitDurability1780020000000
  implements MigrationInterface
{
  name = 'AddPaymentReminderWaitDurability1780020000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_execution_status_scheduled_at"
      ON "automation_execution" ("status", "scheduled_at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation_send_attempt" (
        "id" SERIAL NOT NULL,
        "automation_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "action_type" character varying(64) NOT NULL,
        "attempt" integer NOT NULL,
        "execution_id" integer,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_send_attempt" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_automation_send_attempt_key"
          UNIQUE ("automation_id", "customer_id", "action_type", "attempt")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_send_attempt_execution"
      ON "automation_send_attempt" ("execution_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_automation_send_attempt_execution"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_send_attempt"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_automation_execution_status_scheduled_at"`,
    );
  }
}
