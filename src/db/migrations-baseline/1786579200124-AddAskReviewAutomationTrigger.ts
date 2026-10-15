import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAskReviewAutomationTrigger1786579200124 implements MigrationInterface {
  name = 'AddAskReviewAutomationTrigger1786579200124';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'automation_trigger_enum'
            AND e.enumlabel = 'ask_review'
        ) THEN
          ALTER TYPE "automation_trigger_enum" ADD VALUE 'ask_review';
        END IF;
      END $$;
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Postgres cannot remove enum values safely without recreating the type.
  }
}
