import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessMemberPermissions1779480000000
  implements MigrationInterface
{
  name = 'AddBusinessMemberPermissions1779480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "business_members"
      ADD COLUMN "permissions" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);

    await queryRunner.query(`
      ALTER TABLE "member_invites"
      ADD COLUMN "permissions" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "member_invites"
      DROP COLUMN IF EXISTS "permissions"
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      DROP COLUMN IF EXISTS "permissions"
    `);
  }
}
