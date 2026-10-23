import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMeetingRequestSelectedPlan1786579200151 implements MigrationInterface {
  name = 'AddMeetingRequestSelectedPlan1786579200151';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meeting_request"
        ADD COLUMN IF NOT EXISTS "selected_plan_slug" character varying(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "meeting_request"
        ADD COLUMN IF NOT EXISTS "selected_plan_name" character varying(128)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meeting_request"
        DROP COLUMN IF EXISTS "selected_plan_name"
    `);
    await queryRunner.query(`
      ALTER TABLE "meeting_request"
        DROP COLUMN IF EXISTS "selected_plan_slug"
    `);
  }
}
