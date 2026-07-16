import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddManagerAndStaffRoles1779520000000
  implements MigrationInterface
{
  name = 'AddManagerAndStaffRoles1779520000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "roles" ("name")
      VALUES ('Manager'), ('Staff')
      ON CONFLICT ("name") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "roles"
      WHERE "name" IN ('Manager', 'Staff')
        AND NOT EXISTS (
          SELECT 1 FROM "users" WHERE "users"."role_id" = "roles"."id"
        )
    `);
  }
}
