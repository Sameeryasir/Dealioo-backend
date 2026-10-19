import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowBusinessAdminRole1786579200142 implements MigrationInterface {
  name = 'AllowBusinessAdminRole1786579200142';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "roles" ("name")
      VALUES ('Admin')
      ON CONFLICT ("name") DO NOTHING
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      DROP CONSTRAINT IF EXISTS "CHK_business_members_role"
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      ADD CONSTRAINT "CHK_business_members_role"
      CHECK ("role" IN ('Owner', 'Admin', 'Manager', 'Staff', 'Scanner'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "business_members"
      SET "role" = 'Manager'
      WHERE "role" = 'Admin'
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
  }
}
