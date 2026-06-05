import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScannerRole1779060000000 implements MigrationInterface {
  name = 'AddScannerRole1779060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "roles" ("name")
      VALUES ('Scanner')
      ON CONFLICT ("name") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "roles"
      WHERE "name" = 'Scanner'
        AND NOT EXISTS (
          SELECT 1 FROM "users" WHERE "users"."role_id" = "roles"."id"
        )
    `);
  }
}
