import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefactorFunnelsToPageBuilder1778200000002 implements MigrationInterface {
  name = 'RefactorFunnelsToPageBuilder1778200000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('funnels');
    if (!table || table.findColumnByName('pages')) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "funnels" ADD COLUMN "pages" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "funnels" ADD COLUMN "version" integer NOT NULL DEFAULT 1
    `);
    await queryRunner.query(`
      ALTER TABLE "funnels" ADD COLUMN "published" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "funnels" ADD COLUMN "updated_by" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "funnels"
      ADD CONSTRAINT "FK_funnels_updated_by"
      FOREIGN KEY ("updated_by") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    await queryRunner.query(`ALTER TABLE "funnels" DROP COLUMN "lead_name"`);
    await queryRunner.query(`ALTER TABLE "funnels" DROP COLUMN "lead_email"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('funnels');
    if (!table || table.findColumnByName('lead_name')) {
      return;
    }

    await queryRunner.query(
      `ALTER TABLE "funnels" DROP CONSTRAINT IF EXISTS "FK_funnels_updated_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "funnels" DROP COLUMN IF EXISTS "updated_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "funnels" DROP COLUMN IF EXISTS "published"`,
    );
    await queryRunner.query(
      `ALTER TABLE "funnels" DROP COLUMN IF EXISTS "version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "funnels" DROP COLUMN IF EXISTS "pages"`,
    );
    await queryRunner.query(`
      ALTER TABLE "funnels" ADD COLUMN "lead_name" character varying(255) NOT NULL DEFAULT ''
    `);
    await queryRunner.query(`
      ALTER TABLE "funnels" ADD COLUMN "lead_email" character varying(255) NOT NULL DEFAULT ''
    `);
  }
}
