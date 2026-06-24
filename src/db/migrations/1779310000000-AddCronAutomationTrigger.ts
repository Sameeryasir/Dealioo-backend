import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCronAutomationTrigger1779310000000
  implements MigrationInterface
{
  name = 'AddCronAutomationTrigger1779310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE "automation_trigger_enum" ADD VALUE IF NOT EXISTS 'cron';
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
  }
}
