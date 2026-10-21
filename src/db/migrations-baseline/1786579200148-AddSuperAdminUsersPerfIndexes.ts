import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSuperAdminUsersPerfIndexes1786579200148
  implements MigrationInterface
{
  name = 'AddSuperAdminUsersPerfIndexes1786579200148';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_users_is_active_created_at"
        ON "users" ("is_active", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_users_created_at"
        ON "users" ("created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_business_members_user_status_role"
        ON "business_members" ("user_id", "status", "role")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_subscriptions_user_status_created"
        ON "user_subscriptions" ("user_id", "status", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_user_subscriptions_user_status_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_business_members_user_status_role"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_created_at"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_users_is_active_created_at"`,
    );
  }
}
