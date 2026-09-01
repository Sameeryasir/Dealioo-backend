import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutomationConnectionBranch1780090000000
  implements MigrationInterface
{
  name = 'AddAutomationConnectionBranch1780090000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "automation_connection"
      ADD COLUMN IF NOT EXISTS "branch" character varying(64)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "automation_connection"
      DROP COLUMN IF EXISTS "branch"
    `);
  }
}
