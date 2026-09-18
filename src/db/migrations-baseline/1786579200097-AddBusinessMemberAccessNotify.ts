import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessMemberAccessNotify1786579200097
  implements MigrationInterface
{
  name = 'AddBusinessMemberAccessNotify1786579200097';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "business_members"
      ADD COLUMN IF NOT EXISTS "access_notify_at" TIMESTAMPTZ NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "business_members"
      ADD COLUMN IF NOT EXISTS "access_notify_payload" jsonb NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "business_members"
      DROP COLUMN IF EXISTS "access_notify_payload"
    `);
    await queryRunner.query(`
      ALTER TABLE "business_members"
      DROP COLUMN IF EXISTS "access_notify_at"
    `);
  }
}
