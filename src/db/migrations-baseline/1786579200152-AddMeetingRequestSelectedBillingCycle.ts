import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMeetingRequestSelectedBillingCycle1786579200152
  implements MigrationInterface
{
  name = 'AddMeetingRequestSelectedBillingCycle1786579200152';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meeting_request"
        ADD COLUMN IF NOT EXISTS "selected_billing_cycle" character varying(16)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meeting_request"
        DROP COLUMN IF EXISTS "selected_billing_cycle"
    `);
  }
}
