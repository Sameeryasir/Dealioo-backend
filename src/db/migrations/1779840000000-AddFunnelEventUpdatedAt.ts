import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFunnelEventUpdatedAt1779840000000
  implements MigrationInterface
{
  name = 'AddFunnelEventUpdatedAt1779840000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funnel_event"
      ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
    `);

    await queryRunner.query(`
      UPDATE "funnel_event"
      SET "updated_at" = "created_at"
      WHERE "updated_at" IS DISTINCT FROM "created_at"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funnel_event"
      DROP COLUMN IF EXISTS "updated_at"
    `);
  }
}
