import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFunnelPublishedContentRevision1788440000000
  implements MigrationInterface
{
  name = 'AddFunnelPublishedContentRevision1788440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funnels"
        ADD COLUMN IF NOT EXISTS "published_content_revision" integer
    `);
    await queryRunner.query(`
      UPDATE "funnels"
      SET "published_content_revision" = "content_revision"
      WHERE "published" = true
        AND "published_content_revision" IS NULL
        AND "content_revision" > 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funnels"
        DROP COLUMN IF EXISTS "published_content_revision"
    `);
  }
}
