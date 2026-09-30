import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessMemberGuestNotifyDismissed1786579200108
  implements MigrationInterface
{
  name = 'AddBusinessMemberGuestNotifyDismissed1786579200108';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "business_members"
      ADD COLUMN IF NOT EXISTS "guest_notify_dismissed_at" TIMESTAMPTZ NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "business_members"
      DROP COLUMN IF EXISTS "guest_notify_dismissed_at"
    `);
  }
}
