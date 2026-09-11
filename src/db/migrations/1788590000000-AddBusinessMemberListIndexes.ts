import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessMemberListIndexes1788590000000
  implements MigrationInterface
{
  name = 'AddBusinessMemberListIndexes1788590000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_business_members_business_status"
      ON "business_members" ("business_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_business_members_user_status"
      ON "business_members" ("user_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_business_invitations_business_status_expires"
      ON "business_invitations" ("business_id", "status", "expires_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_business_invitations_business_status_expires"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_business_members_user_status"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_business_members_business_status"
    `);
  }
}
