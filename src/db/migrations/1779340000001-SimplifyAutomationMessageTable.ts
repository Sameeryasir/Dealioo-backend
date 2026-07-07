import { MigrationInterface, QueryRunner } from 'typeorm';

export class SimplifyAutomationMessageTable1779340000001
  implements MigrationInterface
{
  name = 'SimplifyAutomationMessageTable1779340000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_automation_message_restaurant_customer_sent"
    `);
    await queryRunner.query(`
      ALTER TABLE "automation_message"
      DROP CONSTRAINT IF EXISTS "UQ_automation_message_idempotency_key"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_message_restaurant_customer_sent"
      ON "automation_message" ("restaurant_id", "customer_id", "sent_at" DESC)
    `);
    await queryRunner.query(`
      ALTER TABLE "automation_message"
      ADD CONSTRAINT "UQ_automation_message_idempotency_key" UNIQUE ("idempotency_key")
    `);
  }
}
