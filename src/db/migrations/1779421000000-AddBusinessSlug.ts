import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessSlug1779421000000 implements MigrationInterface {
  name = 'AddBusinessSlug1779421000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "businesses"
      ADD COLUMN IF NOT EXISTS "slug" varchar(120)
    `);

    await queryRunner.query(`
      UPDATE "businesses"
      SET "slug" = CONCAT('business-', "id"::text)
      WHERE "slug" IS NULL OR TRIM("slug") = ''
    `);

    await queryRunner.query(`
      ALTER TABLE "businesses"
      ALTER COLUMN "slug" SET NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_businesses_slug"
      ON "businesses" ("slug")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_businesses_slug"
    `);

    await queryRunner.query(`
      ALTER TABLE "businesses"
      DROP COLUMN IF EXISTS "slug"
    `);
  }
}
