import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMemberPlatformRole1788580000000
  implements MigrationInterface
{
  name = 'AddMemberPlatformRole1788580000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "roles" ("name")
      VALUES ('Member')
      ON CONFLICT ("name") DO NOTHING
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      DROP CONSTRAINT IF EXISTS "CHK_business_members_role"
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      ADD CONSTRAINT "CHK_business_members_role"
      CHECK ("role" IN ('Owner', 'Manager', 'Staff', 'Scanner'))
    `);

    await queryRunner.query(`
      UPDATE "users" u
      SET "role_id" = (SELECT r."id" FROM "roles" r WHERE r."name" = 'Admin' LIMIT 1)
      WHERE u."role_id" IN (
        SELECT r."id" FROM "roles" r
        WHERE r."name" IN ('Manager', 'Staff', 'Scanner', 'Viewer')
      )
      AND EXISTS (
        SELECT 1 FROM "businesses" b WHERE b."owner_id" = u."id"
      )
    `);

    await queryRunner.query(`
      UPDATE "users" u
      SET "role_id" = (SELECT r."id" FROM "roles" r WHERE r."name" = 'Member' LIMIT 1)
      WHERE u."role_id" IN (
        SELECT r."id" FROM "roles" r
        WHERE r."name" IN ('Manager', 'Staff', 'Scanner', 'Viewer')
      )
      AND NOT EXISTS (
        SELECT 1 FROM "businesses" b WHERE b."owner_id" = u."id"
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "business_members"
      DROP CONSTRAINT IF EXISTS "CHK_business_members_role"
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      ADD CONSTRAINT "CHK_business_members_role"
      CHECK ("role" IN ('Owner', 'Manager', 'Staff'))
    `);

    await queryRunner.query(`
      UPDATE "users" u
      SET "role_id" = (SELECT r."id" FROM "roles" r WHERE r."name" = 'Admin' LIMIT 1)
      WHERE u."role_id" = (SELECT r."id" FROM "roles" r WHERE r."name" = 'Member' LIMIT 1)
    `);

    await queryRunner.query(`
      DELETE FROM "roles"
      WHERE "name" = 'Member'
        AND NOT EXISTS (
          SELECT 1 FROM "users" WHERE "users"."role_id" = "roles"."id"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "business_members" WHERE "business_members"."role_id" = "roles"."id"
        )
    `);
  }
}
