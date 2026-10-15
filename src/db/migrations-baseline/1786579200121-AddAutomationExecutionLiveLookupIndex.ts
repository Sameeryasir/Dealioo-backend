import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutomationExecutionLiveLookupIndex1786579200121 implements MigrationInterface {
  name = 'AddAutomationExecutionLiveLookupIndex1786579200121';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_execution_automation_customer_status"
      ON "automation_execution" ("automation_id", "customer_id", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_automation_execution_automation_customer_status"`,
    );
  }
}
